const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

class ICrewMonthlyService {
  constructor() {
    this.baseURL = 'https://icrew.airmacau.com.mo';
    this.loginPath = '/Login.aspx';
    this.monthlyReportPath = '/WebPre/MonthlyRoster.aspx';
  }

  async login(username, password) {
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar }));

  const loginURL = this.baseURL + this.loginPath;

  console.log('🔐 Starting iCrew login (Monthly)...');

  // Step 1: GET login page
  const getResponse = await client.get(loginURL);
  const $ = cheerio.load(getResponse.data);

  const eventValidation = $('#__EVENTVALIDATION').val();
  const viewState = $('#__VIEWSTATE').val();
  const viewStateGenerator = $('#__VIEWSTATEGENERATOR').val();

  if (!eventValidation || !viewState || !viewStateGenerator) {
    throw new Error('Missing form fields from login page');
  }

  console.log('✅ Form fields retrieved');

  // Step 2: POST login
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

  const postHTML = postResponse.data;
  const $post = cheerio.load(postHTML);

  // Check for errors
  const scripts = $post('script');
  for (let i = 0; i < scripts.length; i++) {
    const scriptContent = $post(scripts[i]).html();
    if (scriptContent && scriptContent.includes('The password is error')) {
      throw new Error('Invalid iCrew credentials');
    }
  }

  // 🆕 CHECK FOR NOTICE
  const noticeDiv = $post('#ctl00_ContentPlaceHolderMain_divChange');
if (noticeDiv.length > 0) {
  const noticeText = noticeDiv.find('table.DefaultGrid td').first().text().trim();
  if (noticeText) {
    console.log('⚠️ Notice detected:', noticeText);
    throw new Error(`ICREW_NOTICE|||${noticeText}`);
  }
}

  // Check for success
  const form = $post('form[name="aspnetForm"]');
  if (form.length === 0) {
    throw new Error('Login failed - unexpected response');
  }

  console.log('✅ iCrew login successful');

  return client;
}

  async downloadMonthlyRoster(client, month, year) {
    const monthlyURL = this.baseURL + this.monthlyReportPath;

    console.log(`📥 Downloading roster for ${year}-${month}...`);

    // Step 1: GET monthly roster page
    const getResponse = await client.get(monthlyURL);
    const $ = cheerio.load(getResponse.data);

    const eventValidation = $('#__EVENTVALIDATION').val();
    const viewState = $('#__VIEWSTATE').val();
    const viewStateGenerator = $('#__VIEWSTATEGENERATOR').val();

    if (!eventValidation || !viewState || !viewStateGenerator) {
      throw new Error('Missing form fields from roster page');
    }

    // Calculate control index (Jan=02, Feb=03, ..., Dec=13)
    const ctlIndex = month + 1;
    const ctl = String(ctlIndex).padStart(2, '0');
    const eventTarget = `GridView1$ctl${ctl}$lnkEdit`;

    console.log(`🎯 Using event target: ${eventTarget}`);

    // Step 2: POST to filter by year and trigger month
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

    const $post1 = cheerio.load(post1Response.data);

    // Get updated form fields
    const eventValidation2 = $post1('#__EVENTVALIDATION').val();
    const viewState2 = $post1('#__VIEWSTATE').val();
    const viewStateGenerator2 = $post1('#__VIEWSTATEGENERATOR').val();

    if (!eventValidation2 || !viewState2 || !viewStateGenerator2) {
      throw new Error('Missing form fields after first POST');
    }

    console.log('✅ Year filtered, opening month...');

    // Step 3: POST again to open the month
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

    const $post2 = cheerio.load(post2Response.data);

    // Step 4: Extract PDF URL
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

    console.log(`✅ PDF URL found: ${pdfURL}`);

    // Step 5: Download PDF
    const pdfResponse = await client.get(pdfURL, {
      responseType: 'arraybuffer',
    });

    console.log(`✅ PDF downloaded (${pdfResponse.data.length} bytes)`);

    return Buffer.from(pdfResponse.data);
  }
}

module.exports = ICrewMonthlyService;