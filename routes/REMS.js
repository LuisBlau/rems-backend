// Std Library
const {readFileSync} = require('fs')
const path = require('path')
const multiparty = require('multiparty');
const fs = require('fs');
const readline = require('readline');
var bodyParser = require('body-parser')
// setup dirs
var uploadDir = process.env.REMS_HOME + "/uploads";

//setup azure connections
var azureClient = new require("mongodb").MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

//find retailer id
var retailerId;
readRetailerId();



function readRetailerId() {
  const fileStream = fs.createReadStream(process.env.REMS_HOME +"/etc/com.toshibacommerce.service.cloudforwarder.cfg");

  const lineReader = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  lineReader.on('line', function (line) {
    if ( line.includes("retailer-torico-id") )
    {
        var values = line.split("=");
        retailerId = values[1];
    }
  });

}

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
    var filename;
    form.parse(req, function(err, fields, files) {
	    res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('received upload:\n\n');
      if (!fs.existsSync(uploadDir)){
        fs.mkdirSync(uploadDir);
      }
	  let newFileName = uploadDir + "/" + files["file"][0].originalFilename
    filename = files["file"][0].originalFilename;
	  if(fs.existsSync(newFileName)) {
	    newFileName = uploadDir + "/" + files["file"][0].originalFilename + Math.floor(+new Date() / 1000).toString()
	  }
	  fs.copyFile(files["file"][0].path, newFileName, (err) => {
        if (err) throw err;
      });
    });

    //query biggest index
    var uploads = azureClient.db("pas_software_distribution").collection("uploads");
    var results = [];
    uploads.find({retailer_id:retailerId}).sort({id:-1}).limit(1).toArray(function(err, result){
      results = result;
      var index = results[0].id;
      index++;
    
      var currentdate = new Date(); 
      var datetime = currentdate.getFullYear() + "-"
                + ((currentdate.getMonth()+1 < 10)?"0":"")+(currentdate.getMonth()+1) + "-"  
                + ((currentdate.getDate() < 10)?"0":"")+currentdate.getDate() + " "  
                + ((currentdate.getHours() < 10)?"0":"")+currentdate.getHours() + ":"  
                + ((currentdate.getMinutes() < 10)?"0":"")+currentdate.getMinutes() + ":"  
                + ((currentdate.getSeconds() < 10)?"0":"")+currentdate.getSeconds();  

      var newFile = {id:index.toString(),retailer_id: retailerId, filename:filename, inserted:currentdate.getTime(),timestamp:datetime,archived:"false"};
    
      uploads.insertOne(newFile, function(err, res) {
        if (err) throw err;
      });

    });

  });
  
  app.get('/REMS/uploads', (req, res) => {
    var results = []
    var uploads = azureClient.db("pas_software_distribution").collection("uploads");
    uploads.find( {retailer_id:retailerId}).toArray(function(err, result){
      results = result;
      console.log(result)
  
    res.send(results)
    });
  });
  app.post('/sendCommand',bodyParser.json(), (req, res) => {
    res.send('received upload:\n\n');
    console.log(req.body)
  })
}
 