# 부품 사진 파일명 자동화 (hd-project10)

> 🌐 **배포 페이지: [https://aebonlee.github.io/hd-project10/](https://aebonlee.github.io/hd-project10/)** · 저장소: https://github.com/aebonlee/hd-project10

HD건설기계 AMPS기획팀(기획: 홍재영) — 현장 부품 사진의 파일명을 **AI 판독 → 검수 → 일괄 적용**으로 자동 변경하는 도구입니다.

- 파일명 규칙: `연번3자리_품번_(브랜드).JPG` (예: `003_31LM-10310_(HYUNDAI).JPG`), 새 부품 전까지 품번·브랜드 자동 이어받기
- 인식 엔진: **무료 OCR(브라우저 내 처리, 사진 외부 전송 없음)** + Claude/ChatGPT/Solar(Upstage) API 키 선택
- 기존 오류(오독·브랜드 오인·품번 이어받기 실패)를 혼동 문자 보정 + 브랜드 사전 + **검수 화면**으로 해결
- 적용: 폴더 실제 변경(크롬/엣지) / ZIP / Windows .bat + 매핑 CSV
- 연습용 샘플 사진 동봉 (`photo_renamer/sample_photos/`)

상세 사용법·확장 지점: [photo_renamer/README.md](photo_renamer/README.md)
기획서 원문: [CLAUDE.md](CLAUDE.md) · 개발 과정: [docs/개발일지.md](docs/개발일지.md)

관련 저장소: [hd-project08](https://github.com/aebonlee/hd-project08)(마케팅 대시보드·회의록) · [hd-project09](https://github.com/aebonlee/hd-project09)(뉴스레터 대시보드)

## 실행/테스트

- 배포 페이지 접속 권장 (기본 OCR은 웹워커 사용으로 http 접속 필요)
- `node photo_renamer/test/logic.test.js`
