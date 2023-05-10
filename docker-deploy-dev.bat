docker build -t dashboard-express-server:dev .
docker tag dashboard-express-server:dev remscontainer.azurecr.io/dashboard-express-server:dev
docker push remscontainer.azurecr.io/dashboard-express-server:dev