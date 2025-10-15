const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

class ICrewWeeklyService {
  constructor() {
    this.baseURL = 'https://icrew.airmacau.com.mo';
    this.loginPath = '/Login.aspx';
    this.weeklyPath = '/WebPre/Fly/FlyHistory.aspx';
  }

  async login(username, password) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar }));

    const loginURL = this.baseURL + this.loginPath;

    console.log('\n========================================');
    console.log('🔐 Starting iCrew login (Weekly)...');
    console.log('========================================');
    console.log('Username:', username);

    // Step 1: GET login page
    console.log('\n📡 Step 1: GET login page...');
    const getResponse = await client.get(loginURL);
    console.log('✅ GET response received, status:', getResponse.status);
    
    const $ = cheerio.load(getResponse.data);

    const eventValidation = $('#__EVENTVALIDATION').val();
    const viewState = $('#__VIEWSTATE').val();
    const viewStateGenerator = $('#__VIEWSTATEGENERATOR').val();

    console.log('📋 Form fields extracted:');
    console.log('  - __EVENTVALIDATION:', eventValidation ? `${eventValidation.substring(0, 50)}...` : 'MISSING');
    console.log('  - __VIEWSTATE:', viewState ? `${viewState.substring(0, 50)}...` : 'MISSING');
    console.log('  - __VIEWSTATEGENERATOR:', viewStateGenerator || 'MISSING');

    if (!eventValidation || !viewState || !viewStateGenerator) {
      throw new Error('Missing form fields from login page');
    }

    // Step 2: POST login
    console.log('\n📤 Step 2: POST login...');
    const formData = new URLSearchParams({
      __EVENTVALIDATION: eventValidation,
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      'loginButtom.x': '20',
      'loginButtom.y': '30',
      userName: username,
      userPassword: password,
    });

    const postResponse = await client.post(loginURL, formData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
    });

    console.log('✅ POST response received, status:', postResponse.status);

    const postHTML = postResponse.data;
    const $post = cheerio.load(postHTML);

    // Check for errors
    console.log('\n🔍 Step 3: Checking for errors...');
    const scripts = $post('script');
    for (let i = 0; i < scripts.length; i++) {
      const scriptContent = $post(scripts[i]).html();
      if (scriptContent && scriptContent.includes('The password is error')) {
        console.log('❌ Invalid credentials detected');
        throw new Error('Invalid iCrew credentials');
      }
    }

    // CHECK FOR NOTICE
    console.log('🔍 Checking for notice...');
    const noticeDiv = $post('#ctl00_ContentPlaceHolderMain_divChange');
    if (noticeDiv.length > 0) {
      const noticeText = noticeDiv.find('table.DefaultGrid td').first().text().trim();
      if (noticeText) {
        console.log('⚠️ Notice detected:', noticeText);
        throw new Error(`ICREW_NOTICE|||${noticeText}`);
      }
    } else {
      console.log('✅ No notice found');
    }

    // Check for success
    console.log('\n🔍 Step 4: Checking for successful login...');
    const form = $post('form[name="aspnetForm"]');
    console.log('Form with name="aspnetForm" found:', form.length > 0);
    
    if (form.length === 0) {
      throw new Error('Login failed - unexpected response');
    }

    console.log('\n✅ iCrew login successful!');
    console.log('========================================\n');

    return client;
  }

  async downloadWeeklyRoster(client, startDate, endDate) {
    const weeklyURL = this.baseURL + this.weeklyPath;

    console.log('\n========================================');
    console.log('📥 Starting weekly roster download');
    console.log('========================================');
    console.log('URL:', weeklyURL);
    console.log('Date Range:', startDate, 'to', endDate);

    // Step 1: GET initial page
    console.log('\n📡 Step 1: GET initial weekly page...');
    const getResponse = await client.get(weeklyURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
      }
    });
    console.log('✅ GET response received, status:', getResponse.status);
    
    const $ = cheerio.load(getResponse.data);

    let eventValidation = $('#__EVENTVALIDATION').val();
    let viewState = $('#__VIEWSTATE').val();
    let viewStateGenerator = $('#__VIEWSTATEGENERATOR').val();

    console.log('📋 Initial form fields:');
    console.log('  - __EVENTVALIDATION:', eventValidation ? `${eventValidation.substring(0, 30)}...` : 'MISSING');
    console.log('  - __VIEWSTATE:', viewState ? `${viewState.substring(0, 30)}...` : 'MISSING');
    console.log('  - __VIEWSTATEGENERATOR:', viewStateGenerator || 'MISSING');

    if (!eventValidation || !viewState || !viewStateGenerator) {
      throw new Error('Missing form fields from weekly page');
    }

    // Step 2: POST search with date range (matching Swift exactly)
    console.log('\n📤 Step 2: POST search with date range...');
    const searchFormData = new URLSearchParams({
      __EVENTTARGET: '',
      __EVENTARGUMENT: '',
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      __EVENTVALIDATION: eventValidation,
      TxtStartDate: startDate,
      TxtEndDate: endDate,
      'btnCha': 'Search',
    });

    const searchResponse = await client.post(weeklyURL, searchFormData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
      },
    });

    console.log('✅ Search POST response received, status:', searchResponse.status);

    // Step 3: GET report viewer page (matching Swift - with specific headers)
    console.log('\n📡 Step 3: GET report viewer page...');
    
    const reportResponse = await client.get(weeklyURL, {
      headers: {
        'Accept': 'application/x-www-form-urlencoded',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': this.baseURL,
        'Referer': weeklyURL,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
      }
    });

    console.log('✅ Report GET response received, status:', reportResponse.status);

    const $report = cheerio.load(reportResponse.data);

    // Update form fields from report page
    eventValidation = $report('#__EVENTVALIDATION').val();
    viewState = $report('#__VIEWSTATE').val();
    viewStateGenerator = $report('#__VIEWSTATEGENERATOR').val();

    console.log('📋 Report page form fields:');
    console.log('  - __EVENTVALIDATION:', eventValidation ? `${eventValidation.substring(0, 30)}...` : 'MISSING');
    console.log('  - __VIEWSTATE:', viewState ? `${viewState.substring(0, 30)}...` : 'MISSING');
    console.log('  - __VIEWSTATEGENERATOR:', viewStateGenerator || 'MISSING');

    // Step 4: Extract dynamic field value
    console.log('\n🔍 Step 4: Extracting dynamic field value...');

    let dynamicFieldValue = '';

    // Look for the select element - try multiple approaches
    const allSelects = $report('select');
    console.log(`Found ${allSelects.length} total select elements`);

    if (allSelects.length > 0) {
      allSelects.each((i, el) => {
        const name = $report(el).attr('name') || '';
        const id = $report(el).attr('id') || '';
        console.log(`  Select ${i}: name="${name}", id="${id}"`);

        // Match the pattern from Swift: CrystalReportViewer1$ctl02$ctl11
        if (name.includes('CrystalReportViewer1') && name.includes('ctl02') && name.includes('ctl11')) {
          const selectedOption = $report(el).find('option[selected]');
          if (selectedOption.length > 0) {
            dynamicFieldValue = selectedOption.attr('value') || '';
            console.log(`✅ Found selected option: "${dynamicFieldValue}"`);
          } else {
            // No selected option, use first option
            const firstOption = $report(el).find('option').first();
            dynamicFieldValue = firstOption.attr('value') || '';
            console.log(`✅ Using first option: "${dynamicFieldValue}"`);
          }
          return false; // break
        }
      });
    }

    console.log(`\n📊 Final dynamic field value: '${dynamicFieldValue}'`);

    // 🔥 CRITICAL: If no dynamic field value, try to proceed anyway with empty value
    // The Swift code uses ?? "" which means it accepts empty string
    if (!dynamicFieldValue) {
      console.log('⚠️ Warning: Dynamic field is empty, will attempt export anyway...');
      dynamicFieldValue = ''; // Explicitly set to empty string like Swift does
    }

    // Step 5: POST to generate PDF (matching Swift exactly)
    console.log('\n📤 Step 5: POST to generate PDF...');
    const pdfFormData = new URLSearchParams({
      __EVENTTARGET: 'CrystalReportViewer1',
      __EVENTARGUMENT: 'export',
      crystal_handler_page: '/WebPre/Fly/FlyHistory.aspx',
      __LASTFOCUS: '',
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      __EVENTVALIDATION: eventValidation,
      TxtStartDate: startDate,
      TxtEndDate: endDate,
      'CrystalReportViewer1$ctl02$ctl09': '',
      'CrystalReportViewer1$ctl02$ctl11': dynamicFieldValue,
      'CrystalReportViewer1$ctl02$ctl13': '',
      'CrystalReportViewer1$ctl02$ctl15': '150',
      exportformat: 'PDF',
      isRange: 'all',
    });

    console.log('📋 Dynamic field being sent:', `"${dynamicFieldValue}"`);

    const pdfResponse = await client.post(weeklyURL, pdfFormData.toString(), {
      headers: {
        'Accept': 'application/x-www-form-urlencoded',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': this.baseURL,
        'Referer': weeklyURL,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
      },
      responseType: 'arraybuffer',
    });

    console.log('✅ PDF POST response received, status:', pdfResponse.status);

    const pdfData = pdfResponse.data;
    
    // Check if response is actually a PDF
    const pdfSignature = Buffer.from(pdfData).toString('hex', 0, 4);
    const isPDF = pdfSignature === '25504446'; // %PDF in hex
    
    console.log('\n🔍 Validating PDF response...');
    console.log('Response size:', pdfData.length, 'bytes');
    console.log('PDF signature:', pdfSignature, isPDF ? '(Valid PDF)' : '(NOT a PDF)');
    
    if (!isPDF) {
      const textCheck = Buffer.from(pdfData).toString('utf8', 0, 500);
      console.log('Response preview:', textCheck);
      
      if (textCheck.includes('<html') || textCheck.includes('Invalid postback') || textCheck.includes('Server Error')) {
        throw new Error('Server returned HTML error page instead of PDF. The date range may have no roster data.');
      }
    }

    console.log('✅ Valid PDF data received!');
    console.log('========================================\n');
    
    return Buffer.from(pdfData);
  }
}

module.exports = ICrewWeeklyService;