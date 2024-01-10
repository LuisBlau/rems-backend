const axios = require('axios');
const bodyParser = require('body-parser');
const convert = require('xml-js');

module.exports = function (app) {

    const TEST_URL = "https://toshibatagstest.service-now.com";
    const PROD_URL="https://toshibagcs.service-now.com";
    const TEST_ENDPOINT = "/api/tgms/event/createevent";
    const PROD_ENDPOINT="/api/tgms/v1/event/createevent";
    const USERNAME = "pas_ie.integration";
    const TEST_PASSWORD = "&5uw*WYrGipm6IZ-vD*hJqaMMjvZ&kKGJb4Bytrk";
    const PROD_PASSWORD="PasProd1$";

    // Route to create incidents in ServiceNow
    app.post('/snow/createevent', bodyParser.json(), async (req, res) => {
        try {
            const environment = req.query.environment;
            const instanceURL = environment === 'prod' ? PROD_URL : TEST_URL;
            const instanceEndpoint = environment === 'prod' ? PROD_ENDPOINT : TEST_ENDPOINT;
            const password = environment === 'prod' ? PROD_PASSWORD : TEST_PASSWORD;

            // Your incident data
            const incidentData = req.body;

            // Convert incident data to XML format
            const xmlData = convert.js2xml(incidentData, { compact: true, ignoreComment: true, spaces: 4 });

            const config = {
                method: 'post',
                url: `${instanceURL}${instanceEndpoint}`,
                headers: {
                    'Content-Type': 'application/xml',
                },
                auth: {
                    username: USERNAME,
                    password: password,
                },
                data: xmlData,
            };

            const response = await axios(config);

            // Handle the ServiceNow response as needed
            console.log('ServiceNow Response:', response.data);
            return res.status(response.status).json(response.data);
        } catch (ex) {
            console.error(`Failed to create incident with message ${ex.message}`);
            if (ex.response) {
                return res.status(ex.response.status).send(ex.response.data);
            } else {
                return res.status(500).send('Internal Server Error');
            }
        }
    });
};
