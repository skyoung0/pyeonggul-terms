// ============================================================
//  편꿀 토스 로그인 인증 서버  (Railway 배포용)
// ------------------------------------------------------------
//  하는 일:
//   1) 앱에서 받은 인가코드(authorizationCode)를 mTLS 로 토스에 보내
//      accessToken 으로 교환해요.
//   2) accessToken 으로 사용자 정보를 조회해 userKey(앱 단위 고유 식별값)를 얻어요.
//   3) 앱에는 userKey 만 돌려줘요. (이름·전화번호 등 민감정보는 받지도, 보관하지도 않아요)
//
//  mTLS 인증서는 코드에 넣지 않고, Railway 환경변수로 주입해요:
//   - TOSS_MTLS_CERT : pyeonggulmtls_public.crt 파일 내용
//   - TOSS_MTLS_KEY  : pyeonggulmtls_private.key 파일 내용
//   - ALLOW_ORIGIN   : (선택) 허용할 출처. 기본은 토스 미니앱 도메인.
//   - UNLINK_SECRET  : (선택) 연결 끊기 콜백 인증용 basic auth 문자열
// ============================================================

import express from 'express';
import cors from 'cors';
import https from 'node:https';

const app = express();
app.use(express.json());

// 토스 미니앱에서의 호출만 허용 (필요 시 ALLOW_ORIGIN 으로 덮어쓰기)
const ALLOW = process.env.ALLOW_ORIGIN
  ? process.env.ALLOW_ORIGIN.split(',').map((s) => s.trim())
  : [
      'https://pyeonggul.apps.tossmini.com',
      'https://pyeonggul.private-apps.tossmini.com',
    ];
app.use(cors({ origin: ALLOW }));

const TOSS_BASE = 'https://apps-in-toss-api.toss.im';

// mTLS 인증서를 장착한 https 에이전트 (환경변수에서 읽음)
function buildAgent() {
  const cert = process.env.TOSS_MTLS_CERT;
  const key = process.env.TOSS_MTLS_KEY;
  if (!cert || !key) {
    throw new Error('mTLS 인증서 환경변수(TOSS_MTLS_CERT / TOSS_MTLS_KEY)가 없어요.');
  }
  return new https.Agent({
    cert: cert.replace(/\\n/g, '\n'), // 환경변수에 \n 로 들어온 경우 복원
    key: key.replace(/\\n/g, '\n'),
    keepAlive: true,
  });
}
let agent = null;

// 토스 API 호출 (mTLS)
function tossRequest(path, { method = 'POST', body, accessToken } = {}) {
  if (!agent) agent = buildAgent();
  const url = new URL(TOSS_BASE + path);
  const payload = body ? JSON.stringify(body) : null;

  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const options = {
    method,
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers,
    agent,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, json: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// 헬스체크
app.get('/', (_req, res) => res.json({ ok: true, service: 'pyeonggul-auth' }));

// ---- 핵심: 인가코드 → userKey ----
app.post('/login', async (req, res) => {
  try {
    const { authorizationCode, referrer } = req.body ?? {};
    if (!authorizationCode || !referrer) {
      return res.status(400).json({ ok: false, error: 'authorizationCode/referrer 누락' });
    }

    // 1) 토큰 교환
    const tok = await tossRequest(
      '/api-partner/v1/apps-in-toss/user/oauth2/generate-token',
      { method: 'POST', body: { authorizationCode, referrer } }
    );
    const accessToken = tok.json?.success?.accessToken;
    if (!accessToken) {
      return res.status(401).json({ ok: false, error: 'token_exchange_failed', detail: tok.json ?? tok.raw });
    }

    // 2) 사용자 정보 조회 → userKey 만 사용 (민감정보는 무시)
    const me = await tossRequest(
      '/api-partner/v1/apps-in-toss/user/oauth2/login-me',
      { method: 'GET', accessToken }
    );
    const userKey = me.json?.success?.userKey;
    if (userKey == null) {
      return res.status(401).json({ ok: false, error: 'userkey_not_found', detail: me.json ?? me.raw });
    }

    // 앱에는 userKey 만 전달 (문자열로)
    return res.json({ ok: true, userKey: String(userKey) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'server_error', detail: String(e?.message ?? e) });
  }
});

// ---- 연결 끊기 콜백 (콘솔에 이 URL 등록: /unlink) ----
// 토스가 사용자 연결 해제 시 userKey 를 보내줘요. 여기서 해당 사용자 데이터를 정리하면 돼요.
app.post('/unlink', async (req, res) => {
  // (선택) basic auth 검증
  const secret = process.env.UNLINK_SECRET;
  if (secret) {
    const got = (req.headers.authorization || '').replace(/^Basic\s+/i, '');
    if (got !== secret) return res.status(401).json({ ok: false });
  }
  const userKey = req.body?.userKey ?? req.query?.userKey;
  const referrer = req.body?.referrer ?? req.query?.referrer;
  console.log('[unlink]', { userKey, referrer });
  // TODO: 필요하면 여기서 Supabase 의 해당 userKey 데이터 정리
  return res.json({ ok: true });
});
app.get('/unlink', (req, res) => {
  const userKey = req.query?.userKey;
  console.log('[unlink:get]', { userKey, referrer: req.query?.referrer });
  return res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`pyeonggul-auth listening on ${PORT}`));
