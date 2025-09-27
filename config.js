// Configuration file for ICP CMS Attendance Automation
// Copy this file to .env and update the values as needed

module.exports = {
  // Portal URLs
  PORTAL_LOGIN_URL: process.env.PORTAL_LOGIN_URL || 'https://cms.icp.edu.pk/web/login',
  ATTENDANCE_URL: process.env.ATTENDANCE_URL || 'https://cms.icp.edu.pk/faculty/class/attendance/sheet/2283',
  
  // Login Credentials
  USERNAME: '',
  PASSWORD: '',
  
  // File Configuration
  CSV_FILE: process.env.CSV_FILE || 'stu.csv',
  
  // Browser Configuration
  HEADLESS: process.env.HEADLESS === 'true' || false,
  BROWSER_TIMEOUT: parseInt(process.env.BROWSER_TIMEOUT) || 30000,
  PAGE_LOAD_TIMEOUT: parseInt(process.env.PAGE_LOAD_TIMEOUT) || 60000,
  
  // Retry Configuration
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
  RETRY_DELAY: parseInt(process.env.RETRY_DELAY) || 2000,
  
  // Logging Configuration
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug'
};
