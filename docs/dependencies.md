# 실제 설치 의존성

확인일: 2026-09-29. 이 표는 설치된 package.json의 version/license를 읽어 생성했다.

| 패키지 | 버전 | 라이선스 | 용도 |
|---|---|---|---|
| react | 19.3.0 | MIT | 앱 |
| react-dom | 19.3.0 | MIT | 앱 |
| exceljs | 4.4.0 | MIT | 앱 |
| html-to-image | 1.11.13 | MIT | 앱 |
| typescript | 5.9.3 | Apache-2.0 | 빌드/검증 |
| @types/react | 19.3.0 | MIT | 빌드/검증 |
| @types/react-dom | 19.3.0 | MIT | 빌드/검증 |
| @vitejs/plugin-react | 5.2.0 | MIT | 빌드/검증 |
| vite | 7.3.6 | MIT | 빌드/검증 |
| vitest | 4.1.11 | MIT | 빌드/검증 |
| @playwright/test | 1.63.0 | Apache-2.0 | 빌드/검증 |
| fake-indexeddb | 6.2.5 | Apache-2.0 | 빌드/검증 |
| fast-check | 4.10.2 | MIT | 빌드/검증 |
| @types/node | 22.20.4 | MIT | 빌드/검증 |

ExcelJS의 uuid 의존성은 11.1.1 이상 11.x로 override했다. 설치 의존성 트리에서 npm audit가 지적한 uuid 버전을 교체했고 실제 XLSX 생성/재열기 테스트로 호환성을 확인했다. ExcelJS가 배포하는 browser용 dist/exceljs.min.js는 미리 묶인 파일이므로 override가 그 내부 코드까지 다시 빌드하지는 않는다. 따라서 npm audit 0건을 브라우저 번들 내부까지 완전히 검사했다는 의미로 해석하면 안 된다. 앱은 uuid v3/v5/v6의 사용자 제공 버퍼 API를 호출하지 않는다. Vitest도 감사에서 제시한 수정 범위 4.1.11 이상으로 갱신했다. npm의 선택적 peer 의존성 해석 오류 때문에 .npmrc의 legacy-peer-deps=true를 사용하며 lockfile을 고정한다.

라이브러리의 감사 결과는 보안 전체에 대한 보증이 아니다. 원격 로그/AI/분석 스크립트는 포함하지 않는다. 스프레드시트·이미지 입력은 별도 형식·크기·수식 방어를 검사한다.
