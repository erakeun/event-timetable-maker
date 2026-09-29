# 행사 시간표 제작기
이 디렉터리만 독립 앱으로 수정한다. 나눔·ERICAPLUS·HOLMZ와 기존 배포·계정·명단을 수정하거나 이관하지 않는다.
정수 분과 [시작, 종료) 구간을 사용한다. 불가·미확인·동시배정·자격·시간 상한·이동·잠금 제약을 임의 완화하지 않는다. 검증기를 모든 편집·복원·확정 경로에서 공유한다.
확정 스냅샷은 불변이다. IndexedDB revision을 비교하여 다중 탭 덮어쓰기를 차단한다. 입력을 원격으로 보내지 않는다.
검증: npm test, npm run build, npm run test:e2e. 실제 실행 증거만 docs/qa-report.md에 기록한다.
설계와 출처는 docs/product-spec.md, docs/reference-notes.md, 후속 범위는 docs/next-phase.md에 있다.
