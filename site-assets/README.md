# 소개 페이지에 손으로 넣는 자산

`scripts/build-landing-page.mjs`가 여기서 읽어 `web/`으로 복사한다. 스크린샷은
`screenshots/`의 README를 볼 것.

## `icon.png` — 히어로·파비콘 이미지

앱 아이콘(`frontend/assets/images/icon.png`)을 **256px로 줄인 웹용 사본**이다. 원본은
스토어 제출용 1024px PNG라 800KB에 가깝고, 96px로 보여줄 뿐인데 페이지에서 제일 무거운 것이
되어 첫 페인트를 막는다 — 첫인상을 위해 존재하는 페이지에서 그건 그대로 손해다.

이 파일이 없으면 생성기가 앱 아이콘 원본으로 되돌아가므로 빌드가 깨지지는 않는다. 다만
**아이콘을 새로 그리면 이 사본도 다시 만들어야 한다.** 그러지 않으면 앱과 웹의 아이콘이
갈라진다. Windows에서 다시 만드는 법:

```powershell
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('frontend\assets\images\icon.png')
$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, 256, 256)
$bmp.Save((Resolve-Path 'site-assets').Path + '\icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $src.Dispose()
```
