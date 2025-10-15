const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const logger = require('../utils/logger');

class ICrewMonthlyService {
  constructor(username = 'unknown') {
    this.baseURL = 'https://icrew.airmacau.com.mo';
    this.loginPath = '/Login.aspx';
    this.monthlyReportPath = '/WebPre/MonthlyRoster.aspx';
    
    // Create a child logger with context
    this.logger = logger.createRequestLogger({ 
      service: 'MonthlyRoster',
      crewId: username
    });
    
    // Check if debug mode is enabled
    this.debugEnabled = logger.isServiceDebugEnabled();
  }

  // Helper for debug logs
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

      this.debug('Form fields retrieved');

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
      this.debug('Checking for errors');
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

  async downloadMonthlyRoster(client, month, year) {
    const monthlyURL = this.baseURL + this.monthlyReportPath;

    this.logger.info({ month, year }, 'Starting monthly roster download');

    try {
      // Step 1: GET monthly roster page
      this.debug('Step 1: GET monthly roster page');
      const getResponse = await client.get(monthlyURL);
      this.debug('GET response received', { status: getResponse.status });
      
      const $ = cheerio.load(getResponse.data);
      const eventValidation = $('#__EVENTVALIDATION').val();
      const viewState = $('#__VIEWSTATE').val();
      const viewStateGenerator = $('#__VIEWSTATEGENERATOR').val();

      if (!eventValidation || !viewState || !viewStateGenerator) {
        throw new Error('Missing form fields from roster page');
      }

      this.debug('Form fields extracted');

      // Calculate control index
      const ctlIndex = month + 1;
      const ctl = String(ctlIndex).padStart(2, '0');
      const eventTarget = `GridView1$ctl${ctl}$lnkEdit`;

      this.debug('Using event target', { eventTarget });

      // Step 2: POST to filter by year and trigger month
      this.debug('Step 2: POST to filter by year');
      const formData1 = new URLSearchParams({
        __EVENTTARGET: eventTarget,
        __EVENTARGUMENT: '',
        __VIEWSTATE: viewState,
        __VIEWSTATEGENERATOR: viewStateGenerator,
        __EVENTVALIDATION: eventValidation,
        DropDownList1: year,
        btnCha: 'Search',
      });

      const post1Response = await client.post(monthlyURL, formData1.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
      });

      this.debug('First POST response received', { status: post1Response.status });

      const $post1 = cheerio.load(post1Response.data);
      const eventValidation2 = $post1('#__EVENTVALIDATION').val();
      const viewState2 = $post1('#__VIEWSTATE').val();
      const viewStateGenerator2 = $post1('#__VIEWSTATEGENERATOR').val();

      if (!eventValidation2 || !viewState2 || !viewStateGenerator2) {
        throw new Error('Missing form fields after first POST');
      }

      this.debug('Year filtered, opening month');

      // Step 3: POST again to open the month
      this.debug('Step 3: POST to open month');
      const formData2 = new URLSearchParams({
        __EVENTTARGET: eventTarget,
        __EVENTARGUMENT: '',
        __VIEWSTATE: viewState2,
        __VIEWSTATEGENERATOR: viewStateGenerator2,
        __EVENTVALIDATION: eventValidation2,
        DropDownList1: year,
      });

      const post2Response = await client.post(monthlyURL, formData2.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
      });

      this.debug('Second POST response received', { status: post2Response.status });

      const $post2 = cheerio.load(post2Response.data);

      // Step 4: Extract PDF URL
      this.debug('Step 4: Extracting PDF URL');
      const scripts = $post2('script[type="text/javascript"]');
      let pdfURL = null;

      for (let i = 0; i < scripts.length; i++) {
        const scriptContent = $post2(scripts[i]).html();
        if (scriptContent && scriptContent.includes('window.open')) {
          const match = scriptContent.match(/window\.open\('(.*)'\);/);
          if (match && match[1]) {
            pdfURL = match[1].replace('../', '');
            pdfURL = this.baseURL + '/' + pdfURL;
            break;
          }
        }
      }

      if (!pdfURL) {
        throw new Error('Could not find PDF download link');
      }

      this.debug('PDF URL found', { pdfURL });

      // Step 5: Download PDF
      this.debug('Step 5: Downloading PDF');
      const pdfResponse = await client.get(pdfURL, {
        responseType: 'arraybuffer',
      });

      this.logger.info({ 
        size: pdfResponse.data.length,
        month,
        year
      }, 'Monthly roster PDF downloaded successfully');

      return Buffer.from(pdfResponse.data);

    } catch (error) {
      this.logger.error({ 
        error: error.message, 
        month, 
        year 
      }, 'Monthly roster download failed');
      throw error;
    }
  }
}

module.exports = ICrewMonthlyService;