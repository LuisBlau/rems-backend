SELECT property_value, count(property_value) FROM Registers
INNER JOIN Properties ON Registers.property_id = Properties.property_id
WHERE Registers.property_id = '2'
GROUP BY property_value
