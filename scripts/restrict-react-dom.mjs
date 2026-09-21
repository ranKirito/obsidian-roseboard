import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Roseboard never renders scripts or loads JavaScript resources. Remove that
// capability from the bundled renderer, rather than hiding it from scanners.
// Keep this transform public and deterministic so release builds reproduce.
export function restrictReactDOM(source, path) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const createsScript = (node) =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'createElement' &&
    node.arguments.length > 0 &&
    ts.isStringLiteral(node.arguments[0]) &&
    node.arguments[0].text === 'script';
  let scriptCalls = 0;
  const count = (node) => {
    if (createsScript(node)) scriptCalls++;
    ts.forEachChild(node, count);
  };
  count(file);
  // Both pinned React DOM 19.3.0 variants have three script factories.
  // A dependency update must explicitly revalidate this restriction.
  if (scriptCalls !== 3) throw new Error(`React DOM script factories changed: ${scriptCalls}`);
  const blocked = () =>
    ts.factory.createThrowStatement(
      ts.factory.createNewExpression(ts.factory.createIdentifier('Error'), undefined, [
        ts.factory.createStringLiteral('Roseboard does not support script elements or script resources.'),
      ]),
    );
  const result = ts.transform(file, [
    (context) => {
      const visit = (node) => {
        if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'script')
          return ts.factory.updateCaseClause(node, node.expression, [blocked()]);
        if (createsScript(node))
          return ts.factory.createCallExpression(
            ts.factory.createParenthesizedExpression(
              ts.factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                ts.factory.createBlock([blocked()], true),
              ),
            ),
            undefined,
            [],
          );
        return ts.visitEachChild(node, visit, context);
      };
      return (root) => ts.visitNode(root, visit);
    },
  ]);
  try {
    return ts.createPrinter().printFile(result.transformed[0]);
  } finally {
    result.dispose();
  }
}

export const restrictedReactDOM = {
  name: 'restricted-react-dom',
  setup(build) {
    build.onLoad({ filter: /react-dom-client\.(production|development)\.js$/ }, async ({ path }) => ({
      contents: restrictReactDOM(await readFile(path, 'utf8'), path),
      loader: 'js',
    }));
  },
};
