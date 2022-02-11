// Std Library
const {readFileSync} = require('fs')
const path = require('path')
const multiparty = require('multiparty');
const fs = require('fs');
const dir = "./uploaded_files"
function sendRelevantJSON(res, jsonPath) {
  res.send(JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'Data', jsonPath)
    )
  ))
}

module.exports = function (app, connection, log) {


  app.get('/REMS/store-connection', (req, res) => {
    log.info(`GET ${req.originalUrl}`)

    sendRelevantJSON(res, 'store_connection.json');

  })

  app.get('/REMS/vpd', (req, res) => {
    log.info(`GET ${req.originalUrl}`)

    sendRelevantJSON(res, 'out_vpd_filtered.json');
  })

  app.get('/REMS/release', (req, res) => {
    log.info(`GET ${req.originalUrl}`)

    sendRelevantJSON(res, 'out_release.json');
  })

  app.get('/REMS/low-mem', (req, res) => {
    log.info(`GET ${req.originalUrl}`)

    sendRelevantJSON(res, 'low_mem.json');
  })
  app.post("/REMS/uploadfile", (req,res) => {
    console.log("request recieved")
    var form = new multiparty.Form();
    form.parse(req, function(err, fields, files) {
	  console.log(files);
      console.log(fields);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('received upload:\n\n');
      if (!fs.existsSync(dir)){
        fs.mkdirSync(dir);
      }
	  let newFileName = dir + "/" + files["file"][0].originalFilename
	  if(fs.existsSync(newFileName)) {
	    newFileName = dir + "/" + files["file"][0].originalFilename + Math.floor(+new Date() / 1000).toString()
	  }
	  fs.copyFile(files["file"][0].path, newFileName, (err) => {
        if (err) throw err;
      });
    });
  })

}