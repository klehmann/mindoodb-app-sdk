/**
 * Haven-configured views (`launchContext.views`) as runtime view definitions,
 * the way Haven compiles them before building a navigator
 * (mindoodb-haven `bridgeViewFilters.toRuntimeViewDefinition`), so the mock
 * session can evaluate `openViewNavigator(viewId)` over the mock documents.
 */
import type {
  MindooDBAppConfiguredViewFilterRule,
  MindooDBAppResolvedViewDefinition,
  MindooDBAppViewDefinition,
} from "../types";

const field = (path: string) => ({ kind: "field" as const, path });
const literal = (value: unknown) => ({ kind: "literal" as const, value });
const operation = (op: string, args: unknown[]) => ({ kind: "operation" as const, op, args });

function ruleExpression(rule: MindooDBAppConfiguredViewFilterRule) {
  const target = field(rule.field);
  switch (rule.operator) {
    case "notContains":
      return operation("not", [operation("contains", [target, literal(rule.value ?? "")])]);
    case "exists":
    case "notExists":
      return operation(rule.operator, [target]);
    default:
      return operation(rule.operator, [target, literal(rule.value ?? "")]);
  }
}

export function configuredViewDefinition(view: MindooDBAppResolvedViewDefinition): MindooDBAppViewDefinition {
  const filter =
    view.filter.mode === "formula"
      ? { mode: "expression", expression: structuredClone(view.filter.expression) }
      : view.filter.rules.length
        ? {
            mode: "expression",
            expression:
              view.filter.rules.length === 1
                ? ruleExpression(view.filter.rules[0]!)
                : operation(view.filter.match === "all" ? "and" : "or", view.filter.rules.map(ruleExpression)),
          }
        : undefined;
  return {
    id: view.id,
    title: view.description?.trim() || view.id,
    ...(filter ? { filter } : {}),
    defaultExpand: "collapsed",
    columns: view.columns.map((column) => ({
      name: column.name,
      title: column.title,
      role: column.role === "sort" ? "display" : column.role,
      expression:
        column.expression.mode === "field"
          ? field(column.expression.field)
          : structuredClone(column.expression.expression),
      sorting: column.sorting,
      hidden: column.hidden,
      totalMode: column.totalMode,
    })),
  } as MindooDBAppViewDefinition;
}
