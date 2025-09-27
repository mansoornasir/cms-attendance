# ICP CMS Attendance Automation

Automated attendance marking for ICP CMS portal using Playwright.

## Quick Start

1. **Install dependencies:**
   ```bash
   Downlaod and install NodeJS -> https://nodejs.org/en/download/current
   After installing NodeJS, navigate to the attendance directory and run the following commands inside the attendance directory (this needs to be done one time only)

   npm install
   npx playwright install chromium
   ```

2. **Configure your settings in `config.js`:**
   ```javascript
   module.exports = {
     PORTAL_LOGIN_URL: 'https://cms.icp.edu.pk/web/login',
     ATTENDANCE_URL: 'https://cms.icp.edu.pk/faculty/class/attendance/sheet/YOUR_SHEET_ID',
     USERNAME: 'your-email@icp.edu.pk',
     PASSWORD: 'your-password',
     CSV_FILE: 'stu.csv',
     HEADLESS: false
   };
   ```

3. **Add student roll numbers to `stu.csv`:**
   ```csv
   rollno
   221104
   221128
   221153
   ```

4. **Run the automation:**
   ```bash
   npm run mark-attendance
   ```

## How It Works

- Students in `stu.csv` → Marked as **Present**
- All other students on the page → Marked as **Absent**
- Uses numeric matching (ignores prefixes like BSSE, BSCS, BSAI)
- Creates `missing-students-*.csv` for roll numbers not found on the page

## Requirements

- Node.js 16+
- Valid ICP CMS credentials
- Attendance sheet URL

## License

MIT
