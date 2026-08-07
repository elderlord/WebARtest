# XR8 런타임 슬롯 (self-host)

이 폴더에 **8th Wall XR8 엔진 런타임 JS**를 벤더링한다. 앱은 `/xr8/xr8.js`를 로드한다.

## 왜 비어 있나

8th Wall 클라우드(`apps.8thwall.com/xrweb?appKey=…`)는 2026-02-28 종료되어, 과거처럼
스크립트 태그로 클라우드 런타임을 불러올 수 없다. 이제 **오픈소스 엔진 빌드 산출물을
직접 호스팅**해야 한다. 이 파일의 출처·정확한 파일명은 오프라인에서 확정하지 못했으므로
슬롯으로 비워 둔다. (프로젝트 최상위 `README.md`의 "미확정" 항목 참고)

## 채우는 방법 (택1, 착수 시 실물로 확인)

1. **오픈소스 엔진 빌드**: `github.com/8thwall/8thwall`의 `packages/engine`를 빌드해
   나온 UMD/번들 JS를 `xr8.js`로 이 폴더에 복사.
2. **데스크톱 앱 export**: 8th Wall 데스크톱 앱으로 프로젝트를 만들고 export한 산출물에서
   런타임 JS를 추출해 복사.
3. 기존 배포물(예: 관내 `nsmsuperpower.com`)이 self-host 중인 런타임 파일 구성을 참고
   (문서 §8: `external/xr/xr.js`, `xr-slam.js`).

> SLAM(6DoF 자세 유지)은 **바이너리 전용 라이선스**로 별도 배포된다. 이미지 타겟
> 인식만으로 0단계 계측은 가능하나, 근접 유지 성능 검증에는 SLAM 바이너리가 필요하다.
> 상시 배포 전 XR Engine License Agreement 원문 검토가 선행되어야 한다 (문서 §7).
