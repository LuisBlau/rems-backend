SELECT COUNT(*)
FROM Registers
WHERE 
	Registers.property_id = '12' 
	and Registers.logtime >= ( current_date - interval '.5 days' )
