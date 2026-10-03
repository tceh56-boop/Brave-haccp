/** Compatibility wrapper: verification lives in PpkGenerator.gs and existing journal engine. */
function getPpkVerification_(session,data){var c=_ppkCtx_(session,data&&data.locationId);return _ppkRows_('PPK_VERIFICATION',c.organizationId,c.locationId).filter(function(x){return !data||!data.ppkId||x.ppk_id===data.ppkId;});}
