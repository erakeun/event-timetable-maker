# 원본 확인 및 출처

확인일: 2026-09-29. 현재 작업 디렉터리는 프로젝트 없는 빈 폴더였으며 README, AGENTS.md, package.json, 배포 설정, Git 저장소와 remote가 없었다. 상위 경로의 적용 가능한 AGENTS.md도 확인되지 않았다.

## 확인한 원본

사용자가 첨부한 「PROJECT MACH | 행사 시간표·인력배치 제작기 V1 Codex 실행용 구현 프롬프트」 전체를 요구사항으로 읽었다. 기존 나눔 행사 시간표의 코드나 운영 화면은 이 작업공간에서 확인하지 못했다. 개인 PC 전체 검색, 기존 운영 데이터 열람, 계정·Firebase·Sheets·Apps Script 접근은 수행하지 않았다.

다음 공개 주소는 HTTP GET으로 상태 200과 페이지 제목을 확인했다. 주소 확인은 원본 시간표 로직이나 연동 규격을 확인했다는 뜻이 아니다.

| 확인한 주소 | 응답 제목 | 범위 |
|---|---|---|
| https://erakeun.github.io/erica-event-oneq/ | 행사 준비 원큐! · PROJECT MACH | 공개 HTML 응답만 |
| https://erakeun.github.io/nameplate-maker/ | 행사용 명패 생성기 | 공개 HTML 응답만 |
| https://erakeun.github.io/notice-maker/ | 안내문 제작기 | 공개 HTML 응답만 |
| https://erakeun.github.io/erica-campus-map/ | ERICA 캠퍼스맵 | 공개 HTML 응답만 |
| https://github.com/erakeun/ERICAAI | GitHub - erakeun/ERICAAI · GitHub | 저장소 웹 페이지 응답만 |

## 재사용 부분

기존 나눔·ERICAPLUS·HOLMZ 코드·자료는 재사용하지 않았다. 일반 오픈소스 라이브러리 React, Vite, ExcelJS, html-to-image 등을 사용했고 실제 설치 버전과 라이선스는 dependencies.md에 기록한다. 사용자 이름·소속·운영자료는 모든 테스트에서 가상 자료로 대체했다.

## 새로 설계한 부분

정수 분 기반 시간·행사 모델, 독립 검증기, seed 기반 배정 휴리스틱, 잠금과 선택 구간 보존, IndexedDB revision 저장, 확정 스냅샷, 입력 템플릿, 공개 출력과 편집 백업 분리, 한국어 편집 화면을 새로 작성했다.

## 확인하지 못한 부분

나눔 원본 시간표의 실제 알고리즘, DB 규칙, 운영 화면, 계정 권한은 확인하지 않았다. 다른 운영 프로젝트 규칙을 나눔의 사실로 사용하지 않았다. 공개 후보 도구의 데이터 수신·연동 파라미터도 확인하지 않아 어떤 자동 데이터 전달도 구현하지 않았다. 기존 MACH 페이지는 수정·배포하지 않았다.
