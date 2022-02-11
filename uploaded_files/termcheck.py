import json
import time
import os
import subprocess
import os4690.adxserve
from os4690.adxserve import ControllerStatus
from datetime import datetime
terminals = open("/cdrive/f_drive/adxetc/logs/trmstat.jsn")
terminals = json.loads(terminals.read())
logfile = open("/cdrive/f_drive/adxetc/logs/syscheck.log",'a')
for x in terminals.keys():
  if terminals[x]["connected"] and terminals[x]["cont_term"] == "":
    os4690.adxserve.rebootTerminal(int(x))
    time.sleep(1200)
    terminals = open("/cdrive/f_drive/adxetc/logs/trmstat.jsn")
    terminals = json.loads(terminals.read())
    if not terminals[x]["connected"]:
      logfile.write(str(datetime.now()) + " terminal " + x + " failed to reload on command in store "+os4690.adxserve.ControllerStatus().getStoreNumber()+ "\r\n")
    break

if ControllerStatus().getControllerID() == "CP" and not ControllerStatus().isActingMaster():
  print("Controller CP is not master")
  logfile.write(str(datetime.now()) + " Controller CP is not master\r\n")

process = subprocess.Popen([os4690.SHELL_PATH,"-c","host","127.0.0.1"],stdout=subprocess.PIPE)
stdout, stderr = process.communicate()
if "127.0.0.1" not in stdout:
  print("localhost does not resolve to 127.0.0.1")
  logfile.write(str(datetime.now()) + " localhost does not resolve to 127.0.0.1\r\n")
process.wait()

pcproc = subprocess.Popen([os4690.SHELL_PATH, '-c', 'tail', '-n1', 'adxlxpcn::c:/log/release.log'],
                     stdout=subprocess.PIPE, 
                     stderr=subprocess.PIPE)
pcstdout, pcstderr = pcproc.communicate()

cpproc = subprocess.Popen([os4690.SHELL_PATH, '-c', 'tail', '-n1', 'adxlxcpn::c:/log/release.log'],
                     stdout=subprocess.PIPE, 
                     stderr=subprocess.PIPE)
cpstdout, cpstderr = cpproc.communicate()
if pcstdout != cpstdout:
  print("release.log does not match between controllers")
  logfile.write(str(datetime.now()) + " release.log does not match between controllers\r\n")
pcproc.wait()
pcproc.wait()



