@echo off
if not exist venv\Scripts\python.exe (
    echo ERROR: venv not found. Run setup.bat first.
    pause
    exit /b 1
)
if not exist .env (
    echo ERROR: .env not found. Run setup.bat first, then edit .env with your API key.
    pause
    exit /b 1
)
echo Using Python from: venv\Scripts\python.exe
venv\Scripts\python.exe -m uvicorn app.main:app --reload
pause
