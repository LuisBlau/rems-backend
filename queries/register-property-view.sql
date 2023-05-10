SELECT * FROM Registers
INNER JOIN Properties ON Registers.property_id = Properties.property_id
WHERE store = 0043 and register = 43
ORDER BY logtime DESC