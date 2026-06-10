# JelloBeat 단계별 빌드 로드맵

각 Phase는 "완료 기준"을 만족하면 독립적으로 동작해야 한다. 한 번에 한 Phase씩
진행하고, 완료 기준을 통과한 뒤 다음으로 넘어간다.

---

## Phase 0 — 스캐폴딩 & 추상화 뼈대

**목표:** 실행되는 빈 Tauri 앱 + 향후 구조의 인터페이스 정의.

- `create-tauri-app`으로 React+TS+Vite 템플릿 생성.
- `MediaSource` trait 정의 (now_playing / subscribe / transport). 구현은 비워둠.
- `windows` 크레이트를 의존성에 추가(아직 호출 X).
- Tauri command 1개로 프론트↔백 연결 확인("hello" 수준).

**완료 기준:** `npm run tauri dev`로 빈 창이 뜨고, 프론트에서 백엔드 command 호출이 된다.

---

## Phase 1 — MVP: 현재 곡 표시 (SMTC)

**목표:** 지금 재생 중인 곡의 제목/아티스트/앨범아트/재생상태를 오버레이에 표시.

- `MediaSource`의 Windows 구현: `GlobalSystemMediaTransportControlsSessionManager`로
  현재 활성 세션을 잡고 미디어 속성을 읽는다.
- **여러 세션 동시 재생 시 활성 세션 선택 로직**을 반드시 넣는다(브라우저+Spotify 등).
- 폴링이 아니라 이벤트 구독(MediaPropertiesChanged / PlaybackInfoChanged).
- 앨범아트는 thumbnail 스트림을 받아 프론트로 전달.

**완료 기준:** YouTube Music / Spotify 재생 시 곡 정보가 실시간으로 정확히 보인다.

---

## Phase 2 — 음악 제어

**목표:** 오버레이 버튼만으로 재생/일시정지/이전/다음.

- SMTC 세션의 `TryPlayAsync` / `TryPauseAsync` / `TrySkipNext/Previous`.
- 볼륨은 여기서 다루지 않는다(Phase 5).

**완료 기준:** 오버레이만으로 재생 제어가 된다.

---

## Phase 3 — 오버레이 창 (방식 B 확정 지점)

**목표:** 실사용 가능한 투명 클릭스루 오버레이.

- 투명/무테/always-on-top 창. 화면을 덮되 시각적으로는 작은 젤리박스만 보임.
- `set_ignore_cursor_events`로 빈 영역은 클릭 통과, 젤리박스 위에서만 입력 받기.
- 투명도 조절(0~100%) 실시간 적용.
- **여기서 "창 자체 이동(방식 A)"을 도입하지 말 것.** 물리는 Phase 4에서 내부 요소로.

**완료 기준:** 데스크탑 위에 작게 떠 있고, 뒤 작업을 가리지 않으며 투명도 조절이 된다.

---

## Phase 4 — 젤리 물리 (게이미피케이션)

**목표:** 젤리박스를 드래그해 던지면 관성으로 날아가 벽에 튕기고 감속 후 정지.

- position/velocity 모델 + damping. 화면 경계 AABB 충돌 시 속도 반전·감쇠.
- 닿을 때 약간 눌리는 탄성(스쿼시) 연출은 transform scale로.
- 던지기 속도는 드래그 중 포인터 속도에서 계산.
- **유휴 시 애니메이션 루프 정지**(저사양 대응).

**완료 기준:** 마우스로 던질 수 있고, 벽에 튕긴 뒤 자연스럽게 멈춘다.

---

## Phase 5 — 볼륨 (Core Audio)

**목표:** 오버레이에서 대상 앱의 볼륨 조절.

- Windows Core Audio: `IAudioSessionManager2`로 세션 열거 → 대상(YTM/브라우저/Spotify)
  세션의 `ISimpleAudioVolume`로 볼륨 set/get.
- 어떤 세션을 조절할지 매핑 규칙 정의(현재 재생 소스와 연결).

**완료 기준:** 슬라이더로 해당 앱 볼륨이 실제로 바뀐다.

---

## Phase 6 — Discord Rich Presence

**목표:** 현재 곡을 디스코드 상태로 표시(on/off).

- `discord-rich-presence` 크레이트로 IPC 연결, 현재 곡을 presence로 갱신.
- 디스코드 미실행/연결 실패 시 조용히 무시(앱 동작에 영향 없게).
- 설정에서 on/off 토글.

**완료 기준:** 디스코드 프로필에 현재 곡이 표시되고, 끌 수 있다.

---

## Phase 7 — 설정 & 모드 시스템 & OBS

**목표:** 사용자 설정 유지 + 모드 전환 + 방송 대응.

- 자동 저장: 창 위치/크기, 투명도, RPC on/off, 단축키 on/off, OBS 설정, 현재 모드.
  - JSON에 **스키마 버전 필드**를 넣어 향후 마이그레이션 대비.
- 글로벌 단축키(재생/일시정지/이전/다음, on/off). 미디어키와의 중복 등록 주의.
- 모드: 음악 모드(기본) / 게임 모드(반응·갱신 빈도 감소) / 통화 모드.
- OBS 캡처 제외: `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`
  (Win10 2004+). Tauri에서 HWND를 얻어 windows-rs로 호출. Windows 전용 분기.

**완료 기준:** 재실행해도 설정이 유지되고, 모드/단축키/OBS 옵션이 동작한다.

---

## Phase 8 — Polish & 배포 준비

**목표:** 베타 배포 가능.

- 메모리/CPU 최적화, 예외 처리(세션 없음, 디스코드 꺼짐, 권한 등).
- 코드 서명(Windows), Tauri 업데이터 키 서명 + GitHub Releases 연동.
- `cargo audit` / `npm audit` / Dependabot.
- README: 동작 원리(로컬 전용, 외부 전송 없음) 명시 + 설치 안내.

**완료 기준:** 서명된 인스톨러가 나오고, 클린 PC에서 설치·실행된다.

---

## 후순위(별도 트랙, MVP 아님)

- **큐(다음 재생목록) 드롭다운**: SMTC로는 불가. 브라우저 확장 스크래핑 또는
  비공식 YTM 데스크탑 앱(th-ch/youtube-music) 컴패니언 API 연동 시에만 가능.
- **진짜 비트 동기화**: WASAPI loopback으로 시스템 오디오 캡처 후 비트 추정.
- **SD 캐릭터/스킨/테마**: 젤리박스를 Live2D/Spine/Sprite로 교체.
- **크로스플랫폼**: Linux(MPRIS, D-Bus) → macOS(MediaRemote, 15.4+ 제약으로 가장 마지막).
