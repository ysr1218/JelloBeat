# JelloBeat — 프로젝트 컨텍스트 (Claude Code용)

> 이 파일은 매 세션 로드됩니다. 변하지 않는 핵심 결정과 규칙만 둡니다.
> 상세 단계별 로드맵은 `docs/PLAN.md`를 참고하세요.

## 한 줄 요약

Windows에서 재생 중인 음악(주로 YouTube Music, Spotify)의 현재 상태를 작은
always-on-top 오버레이로 보여주고, 재생 제어·볼륨 조절을 하며, 던지고 놀 수 있는
젤리 물리 인터랙션을 제공하는 경량 데스크탑 앱.

## 확정된 핵심 아키텍처 결정 (변경 금지 — 이미 검토 완료)

1. **음악 정보는 Windows Media Session(SMTC)에서 읽는다.**
   - `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager` 사용.
   - Rust에서는 `windows` 크레이트(windows-rs)로 접근.
   - **로그인 / OAuth / 공식 Web API는 절대 구현하지 않는다.** (이유: YouTube Music은
     공식 재생 API가 없고, Spotify Web API는 공개 배포 시 사용자 5명 제한에 걸림.)

2. **볼륨 조절은 SMTC가 아니라 Windows Core Audio(앱별 오디오 세션)로 한다.**
   - `IAudioSessionManager2` / `ISimpleAudioVolume` 사용. 대상 앱(브라우저/YTM)의
     세션 볼륨을 조절. windows-rs로 접근.
   - SMTC에는 볼륨 API가 없으므로 SMTC로 볼륨을 시도하지 말 것.

3. **오버레이는 "화면을 덮는 투명 클릭스루 창 + 내부 젤리박스" 방식이다.**
   - 창 자체를 OS 레벨에서 이동시키지 않는다(방식 A 금지).
   - `transparent: true`, `decorations: false`, `alwaysOnTop: true`.
   - 젤리박스 영역만 마우스 입력을 받고, 나머지는 `set_ignore_cursor_events(true)`로 통과.
   - 이유: 저사양·멀티모니터·향후 Linux(Wayland 위치 제약) 모두에 유리.

4. **물리(던지기/벽 충돌/탄성)는 직접 구현한다. Matter.js를 쓰지 않는다.**
   - 박스 하나의 position/velocity/damping + AABB 벽 충돌이면 충분. 가볍고 빠름.
   - 부드러운 복원은 간단한 스프링 함수로.

5. **음악 소스는 trait로 추상화한다.**
   - `trait MediaSource { now_playing(); subscribe(); transport(cmd); }`
   - 1차로 Windows(SMTC) 구현만 채운다. macOS/Linux는 `#[cfg(target_os=...)]`로 분리해
     나중에 추가(구조만 비워둔다). Core는 추상 인터페이스만 안다.

## 절대 하지 말 것 (하드 룰)

- 로그인/OAuth/공식 API 클라이언트 구현 금지.
- 큐(다음 재생목록) 기능은 **MVP에 넣지 않는다.** (SMTC로 불가능. 후순위 옵션 기능.)
- 비트 애니메이션은 1차로 "재생 중 일정 주기로 흔드는 가짜 비트"로 한다.
  실제 오디오 분석(WASAPI loopback)은 별도 후순위 Phase.
- 어떤 시크릿/키도 커밋하지 않는다. (Discord Application ID는 공개 값이라 OK.)
- 한 Phase가 다른 Phase 구조를 깨지 않게 한다(아래 규칙 참고).

## 기술 스택

- Frontend: React + TypeScript + Vite
- Desktop: Tauri v2 (Rust core)
- 상태관리: Zustand
- 스타일: TailwindCSS
- 애니메이션: CSS transform 우선 (필요 시 Framer Motion은 가볍게)
- Windows 연동: windows-rs (`windows` crate) — SMTC, Core Audio, SetWindowDisplayAffinity
- Discord: `discord-rich-presence` 크레이트 (IPC 방식, on/off 토글)

## 제안 디렉토리 구조

```
src/                      # React 프론트(오버레이 UI, 물리, 설정 화면)
src-tauri/
  src/
    media/                # MediaSource trait + windows(SMTC) 구현
    audio/                # Core Audio 볼륨 제어
    overlay/              # 창 속성, 클릭스루, OBS 제외(SetWindowDisplayAffinity)
    discord/              # Rich Presence
    settings/             # 설정 저장/로드 (JSON, 스키마 버전 포함)
    commands.rs           # Tauri command (프론트 노출, 최소 권한)
docs/PLAN.md              # 단계별 로드맵
```

## 명령어 (실제 값으로 채워 넣을 것)

- 개발 실행: `npm run tauri dev`
- 빌드: `npm run tauri build`
- Rust 린트: `cargo clippy`  / 포맷: `cargo fmt`
- 프론트 린트: `npm run lint`
- 의존성 점검: `cargo audit`, `npm audit`

## 작업 규칙

- **Phase 독립성**: 각 Phase는 독립적으로 동작·테스트 가능해야 한다. 새 기능 추가가
  기존 구조 대수술로 이어지면 안 된다. 확장 가능한 인터페이스 우선.
- 새 의존성을 추가하기 전에 먼저 제안하고 이유를 설명할 것.
- Windows 전용 API(SMTC, Core Audio, SetWindowDisplayAffinity)는 반드시
  `#[cfg(windows)]` 뒤에 두어 향후 크로스플랫폼 빌드가 깨지지 않게 한다.
- 성능: 유휴 시(일시정지·드래그 없음) 렌더 루프를 멈춘다. SMTC는 폴링이 아니라
  이벤트 구독(MediaPropertiesChanged 등)으로 한다.
- 배포 전: 코드 서명, Tauri 업데이터 키 서명을 README에 문서화(키 자체는 커밋 금지).
