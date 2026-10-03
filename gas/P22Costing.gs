// Единственный фасад costing; расчёт остаётся в существующих предметных функциях.
function calculateCanonicalCost_(parentType,parentId){
  return calcRecipeCost_(parentType,parentId);
}
function recalculateCanonicalCostForProduct_(productId){return recalcFoodCostForProduct_(productId);}
function recalculateCanonicalEconomics_(organizationId,locationId,cascadeId){return recalcEconomics_(organizationId,locationId,cascadeId);}
