const fs = require('fs');

module.exports = function(app, connection, log){
  fs.readdirSync(__dirname).forEach(function(file) {
    if (file == "index.js") return;
    let name = file.substr(0, file.indexOf('.'));
    require('./' + name)(app, connection, log);
  });
}