function migrateP22_3EmployeeSafetySchema_(){
  var additions={
    AUTOMATION_DECISIONS:['decision_id','organization_id','location_id','source_code','source_module','severity','title','description','proposed_action','payload_json','status','created_at','expires_at','approved_at','approved_by','executed_at','error'],
    USERS:['position_id','workshop_id','job_type','equipment_ids','updated_at'],
    POSITIONS:['position_id','organization_id','name','code','description','active','created_at','updated_at'],
    EMPLOYEE_EQUIPMENT_PERMISSIONS:['permission_id','employee_id','equipment_id','organization_id','location_id','instruction_id','test_id','result','approved_by','approved_at','valid_until','status','block_rule_code','created_at','updated_at']
  };
  Object.keys(additions).forEach(function(sheet){ if(typeof ensureSchemaColumns_==='function') ensureSchemaColumns_(sheet); });
  return {ok:true, sheets:Object.keys(additions)};
}
