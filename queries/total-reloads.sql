SELECT COUNT(*)
FROM Registers
WHERE 
	Registers.property_id = '12' 
	and Registers.logtime >= ( CURDATE() - INTERVAL .5 DAY )
