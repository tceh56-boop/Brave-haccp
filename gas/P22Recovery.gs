// Recovery facade; business facts are never compensated automatically.
function createP22Recovery_(session,data){return p22RecoveryCreate_(data.operationId,data.eventId,data.cascadeId,session,data.errorCode,data.message,data.retryable);}
