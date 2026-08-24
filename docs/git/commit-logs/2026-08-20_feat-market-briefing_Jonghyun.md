# fix(ui): Label the growth gap by what the dimension actually claims

## 1. 기본 정보

| 항목 | 내용 |
|------|------|
| 작성자 | Jonghyun |
| 브랜치 | feat/market-briefing |
| 날짜 | 2026-08-20 |
| 버전 | v0.9.0 |

---

## 2. 커밋 메시지

```
fix(ui): Label the growth gap by what the dimension actually claims

Version: v0.9.0

후보의 dimension에 따라 growth_gap_pp를 주장으로 볼지 참고 지표로 볼지
구분해서 표시하도록 수정

- dimension을 한글 라벨로 표시 (매출 성장률 / 계약 수주 / 수주잔고 / 점유율)
- revenue_growth_yoy는 갭이 곧 주장이므로 수식 없이 표시
- 나머지 세 dimension은 갭 앞에 "참고" 배지를 붙여 다른 축의 숫자임을 명시
- 미등록 dimension은 원문 문자열로 폴백 (빈칸으로 두지 않음)
- 테스트 3건 추가
```

---

## 3. 변경 파일

| 상태 | 파일 | 설명 |
|------|------|------|
| M | frontend/src/screens/Market.tsx | DIMENSION_KO 라벨 맵, GAP_IS_THE_CLAIM 판정, 후보 카드 렌더 분기 |
| M | frontend/src/screens/Market.module.css | `.ref` 배지 스타일 (기존 --t3 토큰만 사용, 새 컬러 토큰 없음) |
| M | frontend/src/screens/Market.test.tsx | dimension별 라벨 검증 3건 + 기존 케이스에 라벨 어서션 추가 |
| M | hub/src/config.js | briefingDir 주석 보강 (ProtectHome 제약과 BRIEFING_DIR 운영값 설명) |

---

## 4. 변경 배경 및 결과

`growth_gap_pp`는 후보의 `dimension`이 무엇이든 **항상 매출 성장률 비교**다.
게이트가 yfinance에서 두 회사의 분기 매출을 가져와 계산하는 단일 지표이기 때문이다.

그런데 화면은 이 숫자를 dimension과 무관하게 "성장률 갭 -35.1%p" 한 가지 형태로만
보여줬다. `market_share`나 `contract_wins`를 근거로 뽑힌 후보에도 매출 성장률 갭이
대표 지표처럼 붙는 셈이라, 왜 이 종목이 제시됐는지와 아무 상관 없는 음수가
"이 픽은 지고 있다"로 읽혔다.

실제 사례가 있다. 2026-08-19 브리핑의 AMD ← NVDA는 dimension이 `market_share`인데
매출 성장률 갭이 -35.1%p였다. 점유율을 뺏고 있다는 주장과 매출 성장률이 뒤처진다는
사실은 동시에 참일 수 있고, 계약이나 점유율을 잠식하는 도전자가 전사 규모에서 더
작고 느린 것은 이 전략이 찾으려는 거래의 모양 그 자체다. 게이트는 점유율을 재지도
않았으므로 그 숫자로 후보를 판단해서는 안 된다.

변경 후에는 dimension이 `revenue_growth_yoy`일 때만 갭이 근거로 제시되고, 나머지는
"참고" 배지가 붙어 다른 축의 보조 정보임이 드러난다. dimension 자체도 영문 필드명
대신 한글 라벨로 표시되어 무엇을 근거로 뽑힌 후보인지 화면에서 바로 읽힌다.

---

## 5. 중요 변경 사항

- `DIMENSION_KO` 맵과 `GAP_IS_THE_CLAIM` 집합을 Market.tsx에 추가. 후자는 quant-bot
  `schema.GAP_IS_THE_CLAIM`과 같은 규칙의 사본이다. dimension이 4개이고 거의 바뀌지
  않아 사본 비용이 더 싸다고 판단했으나, 게이트에 dimension이 추가되면 프론트가
  모르는 상태가 된다. 그래서 미등록 값은 원문 문자열로 폴백시켜 빈칸이 뜨지 않게 했다.
- 판정 로직은 게이트와 동일한 기준을 쓴다. `revenue_growth_yoy`에서만 `growth_gap_pp`가
  주장 그 자체이고, 나머지 세 dimension에서는 게이트가 측정하지 않은 축이다.
- `.ref` 배지는 기존 `--t3` 토큰만 사용한다. 새 컬러 토큰을 추가하지 않는다는 화면
  제약을 유지했다.
- `hub/src/config.js`는 동작 변경 없이 주석만 보강했다. 운영에서 `BRIEFING_DIR`을
  `/var/lib/briefing/audio`로 두어야 하는 이유(생성기가 ProtectHome=yes 샌드박스에서
  돌아 `/home` 하위에 쓸 수 없음)를 코드 옆에 남겼다.

---

## 6. 통계

| 항목 | 값 |
|------|-----|
| 변경 파일 수 | 4 |
| 추가 라인 | +82 |
| 삭제 라인 | -4 |

---

## 7. 요약

아침 브리핑 화면에서 종목마다 붙던 "성장률 갭" 숫자가, 그 종목이 추천된 이유와
맞을 때만 근거로 표시되도록 바뀌었다.

이전에는 모든 종목에 같은 방식으로 성장률 갭이 붙었다. 그런데 이 숫자는 항상
매출 기준이라, "점유율을 뺏고 있다"거나 "계약을 따내고 있다"는 이유로 뽑힌 종목에도
매출 성장률이 대표 숫자처럼 보였다. 실제로 어제 브리핑에서는 점유율을 근거로 제시된
종목에 매출 성장률이 35%p 뒤처진다는 숫자가 붙어, 마치 나쁜 종목처럼 읽혔다.
큰 회사에서 점유율을 조금씩 가져오는 작은 회사는 원래 전체 매출 성장이 더 느릴 수
있는데도 그렇다.

이제는 추천 이유가 "매출 성장률"인 종목에만 그 숫자가 근거로 제시되고, 다른 이유로
뽑힌 종목에는 "참고" 표시가 붙어 보조 정보임을 알 수 있다. 추천 이유도 영문 대신
한글(매출 성장률 / 계약 수주 / 수주잔고 / 점유율)로 표시되어 왜 이 종목이 올라왔는지
바로 읽힌다.
