@echo off
rem Cloudflare Quick Tunnel: gives localhost:3029 a temporary https URL for testing on a phone.
rem Open the printed https://xxxx.trycloudflare.com in Safari. Stop with Ctrl+C.
where cloudflared >nul 2>nul
if %errorlevel%==0 (
  cloudflared tunnel --url http://localhost:3029
) else (
  "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" tunnel --url http://localhost:3029
)
