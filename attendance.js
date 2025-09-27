const { chromium } = require('playwright');
const { Logger, loadCSVData, validateCSVData, retryOperation, waitForCondition } = require('./utils');
const config = require('./config');

/**
 * ICP CMS Attendance Automation Script
 * Automates the process of marking student attendance on the ICP CMS portal
 */
class AttendanceAutomation {
  constructor() {
    this.logger = new Logger(config.LOG_LEVEL);
    this.browser = null;
    this.page = null;
    this.csvData = null;
  }

  /**
   * Initialize the browser and create a new page
   */
  async initializeBrowser() {
    this.logger.info('🚀 Initializing browser...');
    
    this.browser = await chromium.launch({
      headless: config.HEADLESS,
      timeout: config.BROWSER_TIMEOUT
    });

    this.page = await this.browser.newPage();
    
    // Set viewport and user agent
    await this.page.setViewportSize({ width: 1280, height: 720 });
    await this.page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    this.logger.success('Browser initialized successfully');
  }

  /**
   * Load and validate CSV data
   */
  async loadAttendanceData() {
    this.logger.info(`📊 Loading attendance data from: ${config.CSV_FILE}`);
    
    try {
      this.csvData = await loadCSVData(config.CSV_FILE);
      
      const validation = validateCSVData(this.csvData);
      if (!validation.isValid) {
        throw new Error(`CSV validation failed: ${validation.errors.join(', ')}`);
      }

      this.logger.success(`CSV data loaded successfully`);
      this.logger.info(`📈 Statistics: ${validation.stats.totalStudents} students, ${validation.stats.present} present, ${validation.stats.absent} absent`);
      
      return this.csvData;
    } catch (error) {
      this.logger.error(`Failed to load CSV data: ${error.message}`);
      throw error;
    }
  }

  /**
   * Login to the ICP CMS portal
   */
  async login() {
    this.logger.info('🔐 Logging into ICP CMS portal...');
    
    try {
      await this.page.goto(config.PORTAL_LOGIN_URL, { 
        waitUntil: 'networkidle',
        timeout: config.PAGE_LOAD_TIMEOUT 
      });

      // Wait for login form to be visible - using specific selectors from the portal
      await this.page.waitForSelector('#login', { timeout: 10000 });
      
      // Fill login credentials using the specific selectors
      await this.page.fill('#login', config.USERNAME);
      await this.page.fill('#password', config.PASSWORD);
      
      this.logger.progress('Credentials entered, submitting login form...');
      
      // Submit login form - try multiple possible submit button selectors
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        '.login-btn',
        '.btn-login',
        'button:has-text("Login")',
        'button:has-text("Sign In")'
      ];

      let submitted = false;
      for (const selector of submitSelectors) {
        try {
          const submitBtn = this.page.locator(selector).first();
          if (await submitBtn.count() > 0 && await submitBtn.isVisible()) {
            await submitBtn.click();
            submitted = true;
            break;
          }
        } catch (error) {
          // Continue to next selector
          continue;
        }
      }

      if (!submitted) {
        // Try pressing Enter on the password field as fallback
        await this.page.press('#password', 'Enter');
      }
      
      // Wait for successful login (redirect or dashboard elements)
      await this.page.waitForLoadState('networkidle');
      
      // Check if login was successful by looking for absence of login form
      const isLoggedIn = await this.page.locator('#login').count() === 0;
      
      if (!isLoggedIn) {
        throw new Error('Login failed - still on login page');
      }
      
      this.logger.success('Successfully logged into ICP CMS portal');
      
    } catch (error) {
      this.logger.error(`Login failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Navigate to the attendance sheet page
   */
  async navigateToAttendancePage() {
    this.logger.info('🧭 Navigating to attendance sheet page...');
    
    try {
      await this.page.goto(config.ATTENDANCE_URL, { 
        waitUntil: 'networkidle',
        timeout: config.PAGE_LOAD_TIMEOUT 
      });

      // Wait for attendance page to load - look for the specific table structure
      await this.page.waitForSelector('tr[role="row"]', { timeout: 15000 });
      
      // Wait for the DataTable to be present (more reliable than checkbox visibility)
      await this.page.waitForSelector('#dt_scroll', { timeout: 10000 });
      
      // Note: We'll handle pagination during the marking process
      
      // Count the number of student rows to verify the page loaded correctly
      const studentRows = await this.page.locator('tr[role="row"]').count();
      this.logger.info(`Found ${studentRows} student rows on the page`);
      
      if (studentRows === 0) {
        throw new Error('No student rows found on the attendance page');
      }
      
      this.logger.success('Successfully navigated to attendance page');
      
    } catch (error) {
      this.logger.error(`Failed to navigate to attendance page: ${error.message}`);
      throw error;
    }
  }

  /**
   * Expand the page to show all students (up to 100)
   * This eliminates the need for page navigation
   */
  async expandPageToShowAllStudents() {
    this.logger.info('📄 Expanding page to show all students...');
    
    try {
      // Wait for the page to be fully loaded
      await this.page.waitForTimeout(2000);
      
      // Look for the dropdown that controls the number of entries per page
      // Common selectors for DataTables pagination dropdown
      const dropdownSelectors = [
        'select[name="dt_scroll_length"]',
        'select[name="dt_scroll_length"]',
        '.dataTables_length select',
        'select[aria-controls="dt_scroll"]',
        'select[name="length"]'
      ];
      
      let dropdown = null;
      for (const selector of dropdownSelectors) {
        dropdown = this.page.locator(selector).first();
        if (await dropdown.count() > 0) {
          this.logger.debug(`Found dropdown with selector: ${selector}`);
          break;
        }
      }
      
      if (!dropdown || await dropdown.count() === 0) {
        this.logger.warn('⚠️  Could not find pagination dropdown, trying alternative approach...');
        
        // Try to find any select element that might be the pagination dropdown
        const allSelects = this.page.locator('select');
        const selectCount = await allSelects.count();
        
        for (let i = 0; i < selectCount; i++) {
          const select = allSelects.nth(i);
          const options = await select.locator('option').allTextContents();
          
          // Look for options that contain "100" or similar
          if (options.some(option => option.includes('100') || option.includes('All'))) {
            dropdown = select;
            this.logger.debug(`Found dropdown with options: ${options.join(', ')}`);
            break;
          }
        }
      }
      
      if (dropdown && await dropdown.count() > 0) {
        // Check if this is a selectize dropdown
        const isSelectize = await dropdown.getAttribute('class');
        this.logger.debug(`Dropdown class: ${isSelectize}`);
        
        if (isSelectize && isSelectize.includes('selectized')) {
          this.logger.info('📋 Detected selectize dropdown, using custom handling...');
          
          try {
            // First, try to find the visible selectize dropdown (not the hidden select)
            const selectizeControl = this.page.locator('.selectize-control.dt-selectize');
            const selectizeInput = this.page.locator('.selectize-input.items');
            
            if (await selectizeControl.count() > 0) {
              this.logger.debug('Found selectize control, clicking to open dropdown...');
              await selectizeInput.click();
              await this.page.waitForTimeout(1000);
            } else {
              this.logger.debug('Selectize control not found, trying to click the hidden select...');
              await dropdown.click();
              await this.page.waitForTimeout(1000);
            }
            
            // Look for the dropdown options in the selectize dropdown
            const selectizeOptions = this.page.locator('.selectize-dropdown-content .option');
            const optionCount = await selectizeOptions.count();
            this.logger.debug(`Found ${optionCount} selectize options`);
            
            if (optionCount > 0) {
              // Get all available options
              const options = [];
              for (let i = 0; i < optionCount; i++) {
                const optionText = await selectizeOptions.nth(i).textContent();
                options.push(optionText);
              }
              this.logger.debug(`Available selectize options: ${options.join(', ')}`);
              
              // Find the target option (highest number or "All")
              let targetOption = null;
              let targetIndex = -1;
              
              if (options.some(opt => opt.includes('100'))) {
                targetOption = options.find(opt => opt.includes('100'));
                targetIndex = options.findIndex(opt => opt.includes('100'));
              } else if (options.some(opt => opt.includes('All'))) {
                targetOption = options.find(opt => opt.includes('All'));
                targetIndex = options.findIndex(opt => opt.includes('All'));
              } else {
                // Find the highest number
                const numbers = options.map(opt => parseInt(opt)).filter(num => !isNaN(num));
                if (numbers.length > 0) {
                  const maxNumber = Math.max(...numbers);
                  targetOption = maxNumber.toString();
                  targetIndex = options.findIndex(opt => opt === targetOption);
                }
              }
              
              if (targetOption && targetIndex >= 0) {
                this.logger.info(`Selecting selectize option: ${targetOption}`);
                await selectizeOptions.nth(targetIndex).click();
                
                // Wait for the table to reload
                await this.page.waitForLoadState('networkidle');
                await this.page.waitForTimeout(3000);
                
                this.logger.success(`✅ Successfully expanded page to show ${targetOption} students`);
                return true;
              } else {
                this.logger.warn('⚠️  Could not find suitable selectize option');
                return false;
              }
            } else {
              this.logger.warn('⚠️  No selectize options found');
              return false;
            }
          } catch (error) {
            this.logger.error(`Error handling selectize dropdown: ${error.message}`);
            return false;
          }
        } else {
          // Handle regular HTML select dropdown
          this.logger.info('📋 Using standard HTML select dropdown...');
          
          // Try to select "100" or "All" option
          const options = await dropdown.locator('option').allTextContents();
          this.logger.debug(`Available options: ${options.join(', ')}`);
          
          // Look for "100" option first, then "All", then the highest number
          let targetOption = null;
          if (options.some(opt => opt.includes('100'))) {
            targetOption = options.find(opt => opt.includes('100'));
          } else if (options.some(opt => opt.includes('All'))) {
            targetOption = options.find(opt => opt.includes('All'));
          } else {
            // Find the highest number
            const numbers = options.map(opt => parseInt(opt)).filter(num => !isNaN(num));
            if (numbers.length > 0) {
              const maxNumber = Math.max(...numbers);
              targetOption = maxNumber.toString();
            }
          }
          
          if (targetOption) {
            this.logger.info(`Selecting option: ${targetOption}`);
            await dropdown.selectOption({ label: targetOption });
            
            // Wait for the table to reload
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(3000);
            
            this.logger.success(`✅ Successfully expanded page to show ${targetOption} students`);
            return true;
          } else {
            this.logger.warn('⚠️  Could not find suitable option to expand page');
            return false;
          }
        }
      } else {
        this.logger.warn('⚠️  Could not find pagination dropdown');
        return false;
      }
      
    } catch (error) {
      this.logger.error(`Failed to expand page: ${error.message}`);
      return false;
    }
  }

  /**
   * Navigate to the next page if needed
   */
  async navigateToNextPage() {
    this.logger.info('📄 Checking if we need to navigate to next page...');
    
    try {
      // Wait for the DataTable to be fully loaded
      await this.page.waitForTimeout(2000);
      
      // Try multiple selectors for pagination links
      const paginationSelectors = [
        '.dataTables_paginate a',
        '.paginate_button',
        '.dt-paging a',
        'a[data-dt-idx="2"]',
        'a:has-text("2")'
      ];
      
      let nextPageLink = null;
      for (const selector of paginationSelectors) {
        const links = this.page.locator(selector).all();
        const linkElements = await links;
        
        for (const link of linkElements) {
          const text = await link.textContent();
          if (text && text.trim() === '2') {
            nextPageLink = link;
            this.logger.debug(`Found page 2 link with selector: ${selector}`);
            break;
          }
        }
        
        if (nextPageLink) break;
      }
      
      // If still not found, try a broader search
      if (!nextPageLink) {
        this.logger.debug('Trying broader search for pagination links...');
        const allLinks = this.page.locator('a').all();
        const linkElements = await allLinks;
        
        for (const link of linkElements) {
          const text = await link.textContent();
          if (text && text.trim() === '2') {
            // Check if this link is likely a pagination link
            const href = await link.getAttribute('href');
            const classes = await link.getAttribute('class');
            if (href === '#' || (classes && classes.includes('paginate'))) {
              nextPageLink = link;
              this.logger.debug('Found page 2 link with broader search');
              break;
            }
          }
        }
      }
      
      if (nextPageLink) {
        this.logger.info('Found page 2 link, clicking to navigate to next page...');
        await nextPageLink.click();
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(3000);
        this.logger.success('Successfully navigated to page 2');
        return true;
      } else {
        this.logger.info('No page 2 link found, staying on current page');
        return false;
      }
      
    } catch (error) {
      this.logger.warn(`Failed to navigate to next page: ${error.message}`);
      return false;
    }
  }

  /**
   * Find student row by roll number
   * @param {string} rollNumber - Student roll number
   * @returns {Object} Student row element and checkbox
   */
  async findStudentRow(rollNumber) {
    try {
      // Try multiple approaches to find the student row
      
      // Approach 1: Look for exact text match in span
      let rollNumberSpan = this.page.locator(`span:has-text("${rollNumber}")`).first();
      
      if (await rollNumberSpan.count() === 0) {
        // Approach 2: Look for text that contains the roll number (case insensitive)
        rollNumberSpan = this.page.locator(`span:text-matches("${rollNumber}", "i")`).first();
      }
      
      if (await rollNumberSpan.count() === 0) {
        // Approach 3: Look in any td element
        rollNumberSpan = this.page.locator(`td:has-text("${rollNumber}")`).first();
      }
      
      if (await rollNumberSpan.count() === 0) {
        this.logger.debug(`Roll number not found anywhere for: ${rollNumber}`);
        
        // Debug: List all roll numbers found on the page
        const allSpans = await this.page.locator('td span').allTextContents();
        this.logger.debug(`Available roll numbers on page: ${allSpans.slice(0, 10).join(', ')}...`);
        
        return null;
      }

      // Find the parent row (tr) containing this span
      const row = rollNumberSpan.locator('xpath=ancestor::tr').first();
      
      if (await row.count() === 0) {
        this.logger.debug(`Parent row not found for roll number: ${rollNumber}`);
        return null;
      }

      // Find the attendance checkbox within this row
      // Based on DOM: <label data-attendance_line="120082"> <input type="checkbox" class="" id="filter-green" checked="True">
      const checkbox = row.locator('label[data-attendance_line] input[type="checkbox"]').first();
      
      if (await checkbox.count() === 0) {
        this.logger.debug(`Checkbox not found in row for roll number: ${rollNumber}`);
        return null;
      }

      // Get the attendance line ID for logging
      const label = row.locator('label[data-attendance_line]').first();
      const attendanceLineId = await label.getAttribute('data-attendance_line');
      
      this.logger.debug(`Successfully found student ${rollNumber} with attendance line ID: ${attendanceLineId}`);
      
      return { 
        row, 
        checkbox, 
        label,
        attendanceLineId 
      };
      
    } catch (error) {
      this.logger.debug(`Error finding student row for ${rollNumber}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get all students from the current attendance page
   * @returns {Array} Array of student objects with rollno and row info
   */
  async getAllStudentsFromPage() {
    try {
      this.logger.debug('Getting all students from current page...');
      
      // Find all rows that contain attendance checkboxes
      const attendanceRows = this.page.locator('tr:has(label[data-attendance_line])');
      const rowCount = await attendanceRows.count();
      
      this.logger.debug(`Found ${rowCount} student rows on current page`);
      
      const students = [];
      
      for (let i = 0; i < rowCount; i++) {
        const row = attendanceRows.nth(i);
        
        // Get the roll number from the row
        const rollNumberSpan = row.locator('td span').first();
        const rollNumber = await rollNumberSpan.textContent();
        
        if (rollNumber && rollNumber.trim()) {
          // Get the checkbox and label
          const checkbox = row.locator('label[data-attendance_line] input[type="checkbox"]').first();
          const label = row.locator('label[data-attendance_line]').first();
          const attendanceLineId = await label.getAttribute('data-attendance_line');
          
          // Extract numeric part for matching
          const numericRollNumber = this.extractNumericRollNumber(rollNumber.trim());
          
          students.push({
            rollno: rollNumber.trim(),
            numericRollno: numericRollNumber,
            row,
            checkbox,
            label,
            attendanceLineId
          });
          
          this.logger.debug(`Extracted student: ${rollNumber.trim()} (numeric: ${numericRollNumber}, ID: ${attendanceLineId})`);
        } else {
          this.logger.debug(`Skipping row ${i}: no roll number found`);
        }
      }
      
      this.logger.debug(`Extracted ${students.length} students from page`);
      return students;
      
    } catch (error) {
      this.logger.error(`Error getting all students from page: ${error.message}`);
      return [];
    }
  }

  /**
   * Mark attendance for a single student
   * @param {Object} student - Student data from CSV
   */
  async markStudentAttendance(student) {
    const { rollno, attendance } = student;
    const shouldBePresent = attendance === 'P';
    
    this.logger.progress(`Marking ${rollno} → ${attendance}`);
    
    try {
      const studentRow = await this.findStudentRow(rollno);
      
      if (!studentRow) {
        this.logger.warn(`⚠️  Student ${rollno} not found in attendance sheet`);
        return false;
      }

      const { checkbox, label, attendanceLineId } = studentRow;
      
      // Check current state - the checkbox might have checked="True" attribute
      const isCurrentlyChecked = await checkbox.isChecked();
      const hasCheckedAttribute = await checkbox.getAttribute('checked') === 'True';
      const isActuallyChecked = isCurrentlyChecked || hasCheckedAttribute;
      
      this.logger.debug(`Student ${rollno} (ID: ${attendanceLineId}) - Current state: ${isActuallyChecked ? 'Present' : 'Absent'}, Target: ${shouldBePresent ? 'Present' : 'Absent'}`);
      
      if (shouldBePresent && !isActuallyChecked) {
        // Mark as present - use JavaScript click to bypass visibility issues
        await checkbox.evaluate(el => el.click());
        this.logger.info(`✅ Marked ${rollno} as Present`);
      } else if (!shouldBePresent && isActuallyChecked) {
        // Mark as absent - use JavaScript click to bypass visibility issues
        await checkbox.evaluate(el => el.click());
        this.logger.info(`✅ Marked ${rollno} as Absent`);
      } else {
        this.logger.info(`ℹ️  ${rollno} already marked correctly as ${shouldBePresent ? 'Present' : 'Absent'}`);
      }
      
      // Small delay to ensure the change is processed
      await this.page.waitForTimeout(200);
      
      return true;
      
    } catch (error) {
      this.logger.error(`Failed to mark attendance for ${rollno}: ${error.message}`);
      return false;
    }
  }

  /**
   * Mark attendance for a student directly (used by new logic)
   * @param {Object} student - Student object with row, checkbox, etc.
   * @param {boolean} shouldBePresent - Whether student should be marked as present
   */
  async markStudentAttendanceDirect(student, shouldBePresent) {
    const { rollno, checkbox, attendanceLineId } = student;
    
    this.logger.progress(`Marking ${rollno} → ${shouldBePresent ? 'P' : 'A'}`);
    
    try {
      // Check current state
      const isCurrentlyChecked = await checkbox.isChecked();
      const hasCheckedAttribute = await checkbox.getAttribute('checked') === 'True';
      const isActuallyChecked = isCurrentlyChecked || hasCheckedAttribute;
      
      this.logger.debug(`Student ${rollno} (ID: ${attendanceLineId}) - Current: ${isActuallyChecked ? 'Present' : 'Absent'}, Target: ${shouldBePresent ? 'Present' : 'Absent'}`);
      
      if (shouldBePresent && !isActuallyChecked) {
        // Mark as present
        await checkbox.evaluate(el => el.click());
        this.logger.info(`✅ Marked ${rollno} as Present`);
      } else if (!shouldBePresent && isActuallyChecked) {
        // Mark as absent
        await checkbox.evaluate(el => el.click());
        this.logger.info(`✅ Marked ${rollno} as Absent`);
      } else {
        this.logger.info(`ℹ️  ${rollno} already marked correctly as ${shouldBePresent ? 'Present' : 'Absent'}`);
      }
      
      // Small delay to ensure the change is processed
      await this.page.waitForTimeout(200);
      
      return true;
      
    } catch (error) {
      this.logger.error(`Failed to mark attendance for ${rollno}: ${error.message}`);
      return false;
    }
  }

  /**
   * Fallback method for page-by-page processing when expansion fails
   * @param {Set} presentStudents - Set of present student roll numbers
   */
  async markAllAttendanceFallback(presentStudents) {
    this.logger.info('📝 Using fallback page-by-page processing...');
    
    let presentCount = 0;
    let absentCount = 0;
    let notFoundCount = 0;
    
    // Process page 1
    this.logger.info('📄 Processing students on page 1...');
    const page1Students = await this.getAllStudentsFromPage();
    this.logger.info(`Found ${page1Students.length} students on page 1`);
    
    for (const student of page1Students) {
      const shouldBePresent = presentStudents.has(student.numericRollno);
      const success = await this.markStudentAttendanceDirect(student, shouldBePresent);
      
      if (success) {
        if (shouldBePresent) {
          presentCount++;
          this.logger.info(`✅ Successfully marked ${student.rollno} as Present`);
        } else {
          absentCount++;
        }
      } else {
        notFoundCount++;
      }
      
      await this.page.waitForTimeout(200);
    }
    
    // Check if we need to go to page 2
    const hasNextPage = await this.navigateToNextPage();
    let page2Students = [];
    if (hasNextPage) {
      this.logger.info('📄 Processing students on page 2...');
      page2Students = await this.getAllStudentsFromPage();
      this.logger.info(`Found ${page2Students.length} students on page 2`);
      
      for (const student of page2Students) {
        const shouldBePresent = presentStudents.has(student.numericRollno);
        const success = await this.markStudentAttendanceDirect(student, shouldBePresent);
        
        if (success) {
          if (shouldBePresent) {
            presentCount++;
            this.logger.info(`✅ Successfully marked ${student.rollno} as Present`);
          } else {
            absentCount++;
          }
        } else {
          notFoundCount++;
        }
        
        await this.page.waitForTimeout(200);
      }
    }
    
            // Check for missing students
            const foundStudents = new Set();
            const allPageStudents = [...page1Students, ...page2Students];
            allPageStudents.forEach(student => foundStudents.add(student.numericRollno));
            const missingStudents = this.csvData.filter(student => !foundStudents.has(this.extractNumericRollNumber(student.rollno)));
            
            if (missingStudents.length > 0) {
              this.logger.warn(`⚠️  ${missingStudents.length} students from CSV not found on attendance page:`);
              missingStudents.forEach(student => {
                this.logger.warn(`   - ${student.rollno}`);
              });
              
              // Create CSV file for missing students
              await this.createMissingStudentsCSV(missingStudents);
            }
    
    this.logger.info(`📊 Attendance marking completed (fallback):`);
    this.logger.info(`   ✅ Present: ${presentCount}`);
    this.logger.info(`   ❌ Absent: ${absentCount}`);
    this.logger.info(`   ⚠️  Not found: ${notFoundCount}`);
    this.logger.info(`   📋 Missing from page: ${missingStudents.length}`);
    
    return { presentCount, absentCount, notFoundCount, missingStudents: missingStudents.length };
  }

  /**
   * Mark attendance for all students
   * New logic: Mark students in CSV as Present, all others as Absent
   */
  async markAllAttendance() {
    this.logger.info('📝 Starting attendance marking process...');
    this.logger.info('📋 New logic: Students in CSV = Present, All others = Absent');
    
    // Create a Set of present student numeric roll numbers for quick lookup
    const presentStudents = new Set(this.csvData.map(student => this.extractNumericRollNumber(student.rollno)));
    this.logger.info(`📊 Found ${presentStudents.size} students to mark as Present`);
    this.logger.debug(`Present students (numeric): ${Array.from(presentStudents).join(', ')}`);
    
    let presentCount = 0;
    let absentCount = 0;
    let notFoundCount = 0;
    
    // Expand the page to show all students (up to 100)
    this.logger.info('📄 Expanding page to show all students...');
    const expanded = await this.expandPageToShowAllStudents();
    
    if (!expanded) {
      this.logger.warn('⚠️  Could not expand page, falling back to page-by-page processing');
      // Fall back to the original page-by-page logic
      return await this.markAllAttendanceFallback(presentStudents);
    }
    
    // Get all students from the expanded page
    this.logger.info('📄 Processing all students from expanded page...');
    const allStudents = await this.getAllStudentsFromPage();
    this.logger.info(`Found ${allStudents.length} students on expanded page`);
    this.logger.debug(`All students: ${allStudents.map(s => s.rollno).join(', ')}`);
    
    // Process all students
    for (const student of allStudents) {
      const shouldBePresent = presentStudents.has(student.numericRollno);
      this.logger.debug(`Processing ${student.rollno} (numeric: ${student.numericRollno}): shouldBePresent=${shouldBePresent}`);
      const success = await this.markStudentAttendanceDirect(student, shouldBePresent);
      
      if (success) {
        if (shouldBePresent) {
          presentCount++;
          this.logger.info(`✅ Successfully marked ${student.rollno} as Present`);
        } else {
          absentCount++;
          this.logger.debug(`✅ Successfully marked ${student.rollno} as Absent`);
        }
      } else {
        notFoundCount++;
        this.logger.warn(`❌ Failed to mark ${student.rollno}`);
      }
      
      // Small delay between students
      await this.page.waitForTimeout(200);
    }
    
            // Check for students in CSV that weren't found on the page
            const foundStudents = new Set();
            allStudents.forEach(student => foundStudents.add(student.numericRollno));
            const missingStudents = this.csvData.filter(student => !foundStudents.has(this.extractNumericRollNumber(student.rollno)));
            
            if (missingStudents.length > 0) {
              this.logger.warn(`⚠️  ${missingStudents.length} students from CSV not found on attendance page:`);
              missingStudents.forEach(student => {
                this.logger.warn(`   - ${student.rollno}`);
              });
              
              // Create CSV file for missing students
              await this.createMissingStudentsCSV(missingStudents);
            }
    
    // Special check for the specific students mentioned by user
    const specificStudents = ['BSSE-211112', 'BSSE-211149', 'BSSE-211127', 'BSSE-211158'];
    this.logger.info('🔍 Checking specific students mentioned:');
    specificStudents.forEach(rollno => {
      const inCSV = presentStudents.has(rollno);
      const foundOnPage = foundStudents.has(rollno);
      this.logger.info(`   ${rollno}: CSV=${inCSV}, Found=${foundOnPage}`);
    });
    
    // Show which students from CSV were not found on the page
    if (missingStudents.length > 0) {
      this.logger.error('🚨 MISSING STUDENTS FROM ATTENDANCE PAGE:');
      missingStudents.forEach(student => {
        this.logger.error(`   ❌ ${student.rollno} - In CSV but not found on attendance page`);
      });
    }
    
    this.logger.info(`📊 Attendance marking completed:`);
    this.logger.info(`   ✅ Present: ${presentCount}`);
    this.logger.info(`   ❌ Absent: ${absentCount}`);
    this.logger.info(`   ⚠️  Not found: ${notFoundCount}`);
    this.logger.info(`   📋 Missing from page: ${missingStudents.length}`);
    
    return { presentCount, absentCount, notFoundCount, missingStudents: missingStudents.length };
  }

  /**
   * Submit the attendance form
   */
  async submitAttendance() {
    this.logger.info('💾 Submitting attendance...');
    
    try {
      // Try multiple selectors for the submit button
      const submitSelectors = [
        'button:has-text("Save")',
        'button:has-text("Submit")',
        'button:has-text("Save Attendance")',
        'button:has-text("Update Attendance")',
        'input[type="submit"]',
        '.btn-save',
        '.btn-submit',
        '.btn-primary',
        '#save-attendance',
        '#submit-attendance',
        'button[type="submit"]'
      ];

      let submitButton = null;
      for (const selector of submitSelectors) {
        const button = this.page.locator(selector).first();
        if (await button.count() > 0 && await button.isVisible()) {
          submitButton = button;
          this.logger.debug(`Found submit button with selector: ${selector}`);
          break;
        }
      }

      if (!submitButton) {
        throw new Error('Submit button not found');
      }

      // Scroll to the button to ensure it's visible
      await submitButton.scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(500);
      
      await submitButton.click();
      
      // Wait for submission to complete
      await this.page.waitForLoadState('networkidle');
      
      this.logger.success('✅ Attendance submitted successfully');
      
    } catch (error) {
      this.logger.error(`Failed to submit attendance: ${error.message}`);
      throw error;
    }
  }


  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.logger.info('🧹 Browser closed');
    }
  }

  /**
   * Main execution method
   */
  async run() {
    try {
      this.logger.info('🎯 Starting ICP CMS Attendance Automation');
      
      // Initialize browser
      await this.initializeBrowser();
      
      // Load CSV data
      await this.loadAttendanceData();
      
      // Login to portal
      await this.login();
      
      // Navigate to attendance page
      await this.navigateToAttendancePage();
      
      
      // Mark attendance for all students
      const results = await this.markAllAttendance();
      
      // Wait for user to manually submit attendance
      this.logger.info('⏳ Attendance marking completed. Please review the changes and click the Save button manually when ready.');
      this.logger.info('🔄 The browser will remain open for you to submit the attendance.');
      
      this.logger.success('🎉 Attendance automation completed successfully!');
      this.logger.info(`📈 Final Results: ${results.successCount} students marked, ${results.failureCount} failed`);
      this.logger.info('👆 Please manually click the Save button to submit the attendance.');
      
    } catch (error) {
      this.logger.error(`❌ Automation failed: ${error.message}`);
      throw error;
    } finally {
      // Don't close browser automatically - let user submit manually
      this.logger.info('🔄 Browser will remain open for manual submission.');
      this.logger.info('💡 Close the browser manually when you\'re done.');
      
      // Keep the process alive to prevent browser from closing
      this.logger.info('⏳ Waiting for manual submission... Press Ctrl+C to exit.');
      
      // Keep the process running indefinitely until user manually exits
      return new Promise(() => {
        // This promise never resolves, keeping the process alive
      });
    }
  }

  /**
   * Extract numeric part from roll number (e.g., "BSSE-221104" -> "221104")
   */
  extractNumericRollNumber(rollNumber) {
    if (!rollNumber) return '';
    
    // Extract only the numeric part after the last dash or hyphen
    const match = rollNumber.toString().match(/(\d+)$/);
    return match ? match[1] : '';
  }

  /**
   * Create a CSV file for students that were not found on the attendance page
   */
  async createMissingStudentsCSV(missingStudents) {
    try {
      const fs = require('fs');
      const path = require('path');
      
      // Create filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `missing-students-${timestamp}.csv`;
      
      // Create CSV content
      let csvContent = 'rollno,reason,date\n';
      missingStudents.forEach(student => {
        csvContent += `${student.rollno},Not found on attendance page,${new Date().toISOString().slice(0, 10)}\n`;
      });
      
      // Write the file
      fs.writeFileSync(filename, csvContent);
      
      this.logger.info(`📄 Created missing students CSV: ${filename}`);
      this.logger.info(`   Contains ${missingStudents.length} missing students`);
      this.logger.info(`   File location: ${path.resolve(filename)}`);
      
      return filename;
    } catch (error) {
      this.logger.error(`Failed to create missing students CSV: ${error.message}`);
      return null;
    }
  }
}

// Main execution
async function main() {
  const automation = new AttendanceAutomation();
  
  try {
    await automation.run();
    // Don't exit automatically - let user control the process
    console.log('✅ Automation completed. Browser will remain open for manual submission.');
    console.log('💡 Press Ctrl+C to exit when you\'re done.');
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run the automation if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = AttendanceAutomation;
