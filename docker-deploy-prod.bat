docker build -t dashboard-express-server:prod .
docker tag dashboard-express-server:prod remscontainer.azurecr.io/dashboard-express-server:prod
docker push remscontainer.azurecr.io/dashboard-express-server:prod