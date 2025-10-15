const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const logger = require('../utils/logger');

class ICrewWeeklyService {
  constructor(username = 'unknown') {
    this.baseURL = 'https://icrew.airmacau.com.mo';
    this.loginPath = '/Login.aspx';
    this.weeklyPath = '/WebPre/Fly/FlyHistory.aspx';
    
    // Create a child logger with context
    this.logger = logger.createRequestLogger({ 
      service: 'WeeklyRoster',
      crewId: username
    });
    
    // Check if debug mode is enabled
    this.debugEnabled = logger.isServiceDebugEnabled();
  }

  // Helper for debug logs (only logged if LOG_SERVICE_DEBUG=true)
  debug(message, data = {}) {
    if (this.debugEnabled) {
      this.logger.debug(data, message);
    }
  }

  async login(username, password) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar }));
    const loginURL = this.baseURL + this.loginPath;

    this.logger.info({ username }, 'Starting iCrew login');

    try {
      // Step 1: GET login page
      this.debug('Step 1: GET login page');
      const getResponse = await client.get(loginURL);
      this.debug('GET response received', { status: getResponse.status });
      
      const $ = cheerio.load(getResponse.data);
      const eventValidation = $('#__EVENTVALIDATION').val();
      const viewState = $('#__VIEWSTATE').val();
      const viewStateGenerator = $('#__VIEWSTATEGENERATOR').val();

      if (!eventValidation || !viewState || !viewStateGenerator) {
        throw new Error('Missing form fields from login page');
      }

      this.debug('Form fields extracted successfully');

      // Step 2: POST login
      this.debug('Step 2: POST login');
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

      this.debug('POST response received', { status: postResponse.status });

      const postHTML = postResponse.data;
      const $post = cheerio.load(postHTML);

      // Check for errors
      this.debug('Step 3: Checking for errors');
      const scripts = $post('script');
      for (let i = 0; i < scripts.length; i++) {
        const scriptContent = $post(scripts[i]).html();
        if (scriptContent && scriptContent.includes('The password is error')) {
          throw new Error('Invalid iCrew credentials');
        }
      }

      // Check for notice
      this.debug('Checking for notice');
      const noticeDiv = $post('#ctl00_ContentPlaceHolderMain_divChange');
      if (noticeDiv.length > 0) {
        const noticeText = noticeDiv.find('table.DefaultGrid td').first().text().trim();
        if (noticeText) {
          this.logger.warn({ notice: noticeText }, 'Notice detected from iCrew');
          throw new Error(`ICREW_NOTICE|||${noticeText}`);
        }
      }

      // Check for success
      const form = $post('form[name="aspnetForm"]');
      if (form.length === 0) {
        throw new Error('Login failed - unexpected response');
      }

      this.logger.info({ username }, 'iCrew login successful');
      return client;

    } catch (error) {
      this.logger.error({ error: error.message, username }, 'Login failed');
      throw error;
    }
  }

  async downloadWeeklyRoster(client, startDate, endDate) {
    const weeklyURL = this.baseURL + this.weeklyPath;

    this.logger.info({ startDate, endDate }, 'Starting weekly roster download');

    try {
      // Step 1: GET initial page
      this.debug('Step 1: GET initial weekly page');
      const getResponse = await client.get(weeklyURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
        }
      });
      this.debug('GET response received', { status: getResponse.status });
      
      const $ = cheerio.load(getResponse.data);
      let eventValidation = $('#__EVENTVALIDATION').val();
      let viewState = $('#__VIEWSTATE').val();
      let viewStateGenerator = $('#__VIEWSTATEGENERATOR').val();

      if (!eventValidation || !viewState || !viewStateGenerator) {
        throw new Error('Missing form fields from weekly page');
      }

      this.debug('Initial form fields extracted');

      // Step 2: POST search with date range
      this.debug('Step 2: POST search with date range', { startDate, endDate });
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

      this.debug('Search POST response received', { status: searchResponse.status });

      // Step 3: GET report viewer page
      this.debug('Step 3: GET report viewer page');
      const reportResponse = await client.get(weeklyURL, {
        headers: {
          'Accept': 'application/x-www-form-urlencoded',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': this.baseURL,
          'Referer': weeklyURL,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
        }
      });

      this.debug('Report GET response received', { status: reportResponse.status });

      const $report = cheerio.load(reportResponse.data);
      eventValidation = $report('#__EVENTVALIDATION').val();
      viewState = $report('#__VIEWSTATE').val();
      viewStateGenerator = $report('#__VIEWSTATEGENERATOR').val();

      this.debug('Report page form fields extracted');

      // Step 4: Extract dynamic field value
      this.debug('Step 4: Extracting dynamic field value');
      let dynamicFieldValue = '';
      const allSelects = $report('select');

      if (allSelects.length > 0) {
        this.debug('Found select elements', { count: allSelects.length });
        allSelects.each((i, el) => {
          const name = $report(el).attr('name') || '';
          if (name.includes('CrystalReportViewer1') && name.includes('ctl02') && name.includes('ctl11')) {
            const selectedOption = $report(el).find('option[selected]');
            if (selectedOption.length > 0) {
              dynamicFieldValue = selectedOption.attr('value') || '';
            } else {
              const firstOption = $report(el).find('option').first();
              dynamicFieldValue = firstOption.attr('value') || '';
            }
            return false;
          }
        });
      }

      if (!dynamicFieldValue) {
        this.logger.warn('Dynamic field is empty, attempting export anyway');
        dynamicFieldValue = '';
      } else {
        this.debug('Dynamic field value extracted', { value: dynamicFieldValue });
      }

      // Step 5: POST to generate PDF
      this.debug('Step 5: POST to generate PDF');
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

      this.debug('PDF POST response received', { status: pdfResponse.status });

      const pdfData = pdfResponse.data;
      const pdfSignature = Buffer.from(pdfData).toString('hex', 0, 4);
      const isPDF = pdfSignature === '25504446';
      
      if (!isPDF) {
        const textCheck = Buffer.from(pdfData).toString('utf8', 0, 500);
        this.debug('Response is not a PDF', { preview: textCheck.substring(0, 100) });
        
        if (textCheck.includes('<html') || textCheck.includes('Invalid postback') || textCheck.includes('Server Error')) {
          throw new Error('Server returned HTML error page instead of PDF');
        }
      }

      this.logger.info({ 
        size: pdfData.length, 
        isPDF,
        startDate,
        endDate 
      }, 'Weekly roster PDF downloaded successfully');
      
      return Buffer.from(pdfData);

    } catch (error) {
      this.logger.error({ 
        error: error.message, 
        startDate, 
        endDate 
      }, 'Weekly roster download failed');
      throw error;
    }
  }
}

module.exports = ICrewWeeklyService;