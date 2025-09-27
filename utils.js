const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

/**
 * Logger utility for consistent logging throughout the application
 */
class Logger {
  constructor(level = 'info') {
    this.level = level;
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
  }

  log(level, message, ...args) {
    if (this.levels[level] <= this.levels[this.level]) {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      console.log(prefix, message, ...args);
    }
  }

  error(message, ...args) {
    this.log('error', message, ...args);
  }

  warn(message, ...args) {
    this.log('warn', message, ...args);
  }

  info(message, ...args) {
    this.log('info', message, ...args);
  }

  debug(message, ...args) {
    this.log('debug', message, ...args);
  }

  success(message, ...args) {
    this.log('info', `✅ ${message}`, ...args);
  }

  progress(message, ...args) {
    this.log('info', `🔄 ${message}`, ...args);
  }
}

/**
 * Load and parse CSV file containing student attendance data
 * @param {string} csvFilePath - Path to the CSV file
 * @returns {Promise<Array>} Array of student objects with rollno (all marked as Present)
 */
async function loadCSVData(csvFilePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    
    if (!fs.existsSync(csvFilePath)) {
      reject(new Error(`CSV file not found: ${csvFilePath}`));
      return;
    }

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (data) => {
        // Normalize the data - handle different possible column names
        const normalizedData = {
          rollno: data.rollno || data.roll_no || data.roll || data.id
        };

        // Validate required fields - only rollno is required now
        if (!normalizedData.rollno) {
          console.warn(`⚠️  Skipping invalid row:`, data);
          return;
        }

        // All students in CSV are marked as Present
        normalizedData.attendance = 'P';

        results.push(normalizedData);
      })
      .on('end', () => {
        resolve(results);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

/**
 * Validate CSV data structure
 * @param {Array} csvData - Parsed CSV data
 * @returns {Object} Validation result with isValid and errors
 */
function validateCSVData(csvData) {
  const errors = [];
  
  if (!Array.isArray(csvData) || csvData.length === 0) {
    errors.push('CSV file is empty or invalid');
    return { isValid: false, errors };
  }

  // Check for duplicate roll numbers
  const rollNumbers = csvData.map(row => row.rollno);
  const duplicates = rollNumbers.filter((rollno, index) => rollNumbers.indexOf(rollno) !== index);
  if (duplicates.length > 0) {
    errors.push(`Duplicate roll numbers found: ${duplicates.join(', ')}`);
  }

  // Check for missing required fields
  const missingFields = csvData.filter(row => !row.rollno || !row.attendance);
  if (missingFields.length > 0) {
    errors.push(`${missingFields.length} rows missing required fields (rollno, attendance)`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    stats: {
      totalStudents: csvData.length,
      present: csvData.filter(row => row.attendance === 'P').length,
      absent: csvData.filter(row => row.attendance === 'A').length
    }
  };
}

/**
 * Create a sample CSV file for testing
 * @param {string} filePath - Path where to create the sample CSV
 * @param {number} studentCount - Number of students to generate
 */
function createSampleCSV(filePath, studentCount = 10) {
  const students = [];
  
  for (let i = 1; i <= studentCount; i++) {
    const rollno = `BSSE-${String(i).padStart(6, '0')}`;
    const name = `Student ${i}`;
    const attendance = Math.random() > 0.3 ? 'P' : 'A'; // 70% present rate
    
    students.push({ rollno, name, attendance });
  }

  const csvContent = [
    'rollno,name,attendance',
    ...students.map(s => `${s.rollno},${s.name},${s.attendance}`)
  ].join('\n');

  fs.writeFileSync(filePath, csvContent);
  console.log(`📄 Sample CSV created: ${filePath} with ${studentCount} students`);
}

/**
 * Retry utility for handling failed operations
 * @param {Function} operation - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delay - Delay between retries in milliseconds
 * @returns {Promise} Result of the operation
 */
async function retryOperation(operation, maxRetries = 3, delay = 2000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        console.log(`⚠️  Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Wait for a condition to be true
 * @param {Function} condition - Function that returns a boolean
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @param {number} interval - Check interval in milliseconds
 * @returns {Promise<boolean>} True if condition met, false if timeout
 */
async function waitForCondition(condition, timeout = 10000, interval = 500) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  return false;
}

module.exports = {
  Logger,
  loadCSVData,
  validateCSVData,
  createSampleCSV,
  retryOperation,
  waitForCondition
};
