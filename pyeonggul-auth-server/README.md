# 편꿀 토스 로그인 인증 서버

앱에서 받은 인가코드를 mTLS로 토스와 교환해 **userKey**만 돌려주는 작은 서버예요.

## Railway 배포 순서

1. 이 폴더를 GitHub 저장소로 올려요 (예: pyeonggul-auth-server).
   - **주의: .key / .crt 인증서 파일은 절대 올리지 마세요.** (.gitignore에 막아둠)
2. Railway → New Project → Deploy from GitHub repo → 이 저장소 선택.
3. Railway → Variables 에 아래 환경변수를 추가해요:

   | 이름 | 값 |
   |------|-----|
   | `TOSS_MTLS_CERT` | pyeonggulmtls_public.crt 파일 **내용 전체** 붙여넣기 |
   | `TOSS_MTLS_KEY`  | pyeonggulmtls_private.key 파일 **내용 전체** 붙여넣기 |

   - 파일 내용은 `-----BEGIN ...-----` 부터 `-----END ...-----` 까지 통째로 복사해 넣어요.
   - 줄바꿈이 그대로 들어가면 제일 좋고, 한 줄로 들어가면 코드가 자동 복원해요.

4. 배포되면 Railway가 주는 공개 URL을 확인해요 (예: https://pyeonggul-auth-server-production.up.railway.app).

## 엔드포인트

- `POST /login`  — body: `{ authorizationCode, referrer }` → `{ ok, userKey }`
- `POST /unlink` — 토스 연결 끊기 콜백 (콘솔에 등록)
- `GET  /`       — 헬스체크

## 동작 확인

배포 후 브라우저에서 공개 URL을 열어 `{"ok":true,...}` 가 보이면 성공이에요.
