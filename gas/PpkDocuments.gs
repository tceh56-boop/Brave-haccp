/** Document facade; keeps document generation deterministic and source-aware. */
function getPpkDocument_(session,data){var c=_ppkCtx_(session,data&&data.locationId);var docs=_ppkRows_('PPK_DOCUMENTS',c.organizationId,c.locationId).filter(function(x){return !data||!data.ppkId||x.ppk_id===data.ppkId;});return docs[docs.length-1]||generatePpkDocument_(session,data||{});}
