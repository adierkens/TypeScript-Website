const ts = require("typescript")
const fs = require("fs")
const path = require("path")
const {
  createFSBackedSystem,
  getAllFileNames,
  addAllFilesFromFolder,
  createVirtualTypeScriptEnvironment,
  createDefaultMapFromNodeModules,
} = require(".")
const complierOptions = {
  jsx: ts.JsxEmit.React,
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2016,
}
// Create a map of all files + libs
const fsMap = createDefaultMapFromNodeModules(complierOptions)
addAllFilesFromFolder(fsMap, ".")
fsMap.set(
  "react.d.ts",
  fs.readFileSync(path.join(__dirname, "..", "..", "node_modules", "@types", "react", "index.d.ts"), "utf-8")
)
const acquiredTypes = {}
const fileName = "index.tsx"
const file = `
import React from '/react';
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
declare type PropsOf<
  E extends keyof JSX.IntrinsicElements | React.JSXElementConstructor<any>
> = JSX.LibraryManagedAttributes<E, React.ComponentPropsWithoutRef<E>>;
export declare type RefOf<
  E extends keyof JSX.IntrinsicElements | React.JSXElementConstructor<any>
> = JSX.LibraryManagedAttributes<E, React.ComponentPropsWithRef<E>>["ref"];

/** Props for a Box component that supports the "innerRef" and "as" props. */
type BoxProps<E extends React.ElementType, P = any> = P &
  Omit<PropsOf<E>, keyof P> & {
    /** Render the component as another component */
    as?: E;

    /** A ref to attach to the component root DOM element */
    innerRef?: RefOf<E>;
  };
interface StackBaseProps {
  /** The flex "align" property */
  align?: 'stretch' | 'center' | 'flex-start' | 'flex-end';
}
const defaultElement = 'div' as const;
/** ComplexGenericUnionIntersection description */
export const ComplexGenericUnionIntersection = <
  E extends React.ElementType = typeof defaultElement
>(
  props: BoxProps<E, StackBaseProps>
) => <div />;
<ComplexGenericUnionIntersection `
fsMap.set(fileName, file)
// Create a system with those files
const system = createFSBackedSystem(fsMap)
const files = getAllFileNames(fileName, fsMap, complierOptions, system)
// Load the system into TypeScript env
const env = createVirtualTypeScriptEnvironment(system, ["index.tsx", "react.d.ts"], ts, complierOptions)
const contextToken = ts.findPrecedingToken(file.length, env.getSourceFile(fileName))
const typeChecker = env.languageService.getProgram().getTypeChecker()

const contextualType = typeChecker.getContextualType(contextToken)
const props = typeChecker.getAllPossiblePropertiesOfTypes(contextualType.types)
props.forEach(p => {
  try {
    console.log(p.escapedName, typeChecker.typeToString(typeChecker.getTypeFromTypeNode(p.valueDeclaration.type)))
  } catch (e) {}
})
