@echo off
chcp 65001 >nul
echo ========================================
echo   نشر إصلاح حلب (سوريا / الوميض)
echo ========================================
echo.

cd /d "%~dp0"

git pull https://github.com/Georgebahna57/sandouk-nemr.git halab-production
if errorlevel 1 (
  echo.
  echo فشل سحب التحديث — تأكد من اتصال الانترنت
  pause
  exit /b 1
)

git push origin main
if errorlevel 1 (
  echo.
  echo فشل الرفع — قد تحتاج: git pull origin main --allow-unrelated-histories
  pause
  exit /b 1
)

echo.
echo تم بنجاح — انتظر دقيقتين ثم امسح كاش Chrome على جهاز سوريا
pause
