import {
  createSystem,
  createFSBackedSystem,
  addAllFilesFromFolder,
  createVirtualTypeScriptEnvironment,
  createDefaultMapFromNodeModules,
  createDefaultMapFromCDN,
  knownLibFilesForCompilerOptions,
} from "../src"

import path from "path"
import ts from "typescript"

it("runs a virtual environment and gets the right results from the LSP", () => {
  const fsMap = createDefaultMapFromNodeModules({})
  fsMap.set("index.ts", "const hello = 'hi'")

  const system = createSystem(fsMap)

  const compilerOpts = {}
  const env = createVirtualTypeScriptEnvironment(system, ["index.ts"], ts, compilerOpts)

  // You can then interact with the languageService to introspect the code
  const definitions = env.languageService.getDefinitionAtPosition("index.ts", 7)
  expect(definitions).toMatchInlineSnapshot(`
    Array [
      Object {
        "containerKind": undefined,
        "containerName": "",
        "contextSpan": Object {
          "length": 18,
          "start": 0,
        },
        "fileName": "index.ts",
        "isLocal": false,
        "kind": "const",
        "name": "hello",
        "textSpan": Object {
          "length": 5,
          "start": 6,
        },
      },
    ]
  `)
})

const getAllFileNames = (
  fileName: string,
  fsMap: Map<string, string>,
  compilerOpts: ts.CompilerOptions,
  system: ts.System
) => {
  const files = [fileName]
  const content = fsMap.get(fileName)

  if (!content) {
    return files
  }

  // Preprocess source file for imports
  const seen: string[] = []
  let { importedFiles } = ts.preProcessFile(content, true)

  for (const module of importedFiles) {
    if (seen.includes(module.fileName)) {
      continue
    }

    const resolutionInfo = ts.resolveModuleName(module.fileName, fileName, compilerOpts, system)
    seen.push(module.fileName)

    if (resolutionInfo.resolvedModule) {
      files.push(resolutionInfo.resolvedModule.resolvedFileName)
      // Process imports of imports
      const importContent = fsMap.get(resolutionInfo.resolvedModule.resolvedFileName)

      if (importContent) {
        ts.preProcessFile(importContent, true).importedFiles.map(f => importedFiles.push(f))
      }
    }
  }

  return files
}

it("runs can use a FS backed system", () => {
  const compilerOpts: ts.CompilerOptions = { target: ts.ScriptTarget.ES2016, esModuleInterop: true }
  const fsMap = createDefaultMapFromNodeModules(compilerOpts)
  addAllFilesFromFolder(fsMap, path.resolve(path.join(__dirname, "../../../node_modules/@types")))

  const fileName = "index.ts"
  const content = `import * as pkg from './foo';\npkg.`
  fsMap.set(fileName, content)

  const fileName2 = "foo.ts"
  const content2 = `export * from './bar';`
  fsMap.set(fileName2, content2)

  const fileName3 = "bar.ts"
  const content3 = `export const bar = 123;`
  fsMap.set(fileName3, content3)

  const system = createFSBackedSystem(fsMap)
  const files = getAllFileNames(fileName, fsMap, compilerOpts, system)
  const env = createVirtualTypeScriptEnvironment(system, files, ts, compilerOpts)
  const completions = env.languageService.getCompletionsAtPosition(fileName, content.length, {})

  expect(completions).toMatchSnapshot()
})

it.only("runs can use a FS backed system - node", () => {
  const compilerOpts: ts.CompilerOptions = { target: ts.ScriptTarget.ES2016, esModuleInterop: true }
  const fsMap = createDefaultMapFromNodeModules(compilerOpts)
  addAllFilesFromFolder(fsMap, path.resolve(path.join(__dirname, "../../../node_modules/@types")))

  const fileName = "index.ts"
  const content = `import * as path from 'path';\npath.`
  fsMap.set(fileName, content)

  const system = createFSBackedSystem(fsMap)
  const files = getAllFileNames(fileName, fsMap, compilerOpts, system)
  const env = createVirtualTypeScriptEnvironment(system, files, ts, compilerOpts)
  const completions = env.languageService.getCompletionsAtPosition(fileName, content.length, {})

  expect(completions).toMatchSnapshot()
})

// Previously lib.dom.d.ts was not included
it("runs a virtual environment with the default globals", () => {
  const fsMap = createDefaultMapFromNodeModules({})
  fsMap.set("index.ts", "console.log('Hi!'')")

  const system = createSystem(fsMap)
  const compilerOpts = {}
  const env = createVirtualTypeScriptEnvironment(system, ["index.ts"], ts, compilerOpts)

  const definitions = env.languageService.getDefinitionAtPosition("index.ts", 7)!
  expect(definitions.length).toBeGreaterThan(0)
})

// Ensures that people can include something lib es2015 etc
it("handles 'lib' in compiler options", () => {
  const compilerOpts = {
    lib: ["es2015", "ES2020"],
  }
  const fsMap = createDefaultMapFromNodeModules(compilerOpts)
  fsMap.set("index.ts", "Object.keys(console)")

  const system = createSystem(fsMap)
  const env = createVirtualTypeScriptEnvironment(system, ["index.ts"], ts, compilerOpts)

  const definitions = env.languageService.getDefinitionAtPosition("index.ts", 7)!
  expect(definitions.length).toBeGreaterThan(0)
})

//
it("compiles in the right DTS files", () => {
  const opts = { target: ts.ScriptTarget.ES2015 }

  const fsMap = createDefaultMapFromNodeModules(opts)
  fsMap.set("index.ts", "[1,3,5,6].find(a => a === 2)")

  const system = createSystem(fsMap)
  const env = createVirtualTypeScriptEnvironment(system, ["index.ts"], ts, opts)

  const semDiags = env.languageService.getSemanticDiagnostics("index.ts")
  expect(semDiags.length).toBe(0)
})

// Hrm, it would be great to get this working
it.skip("emits new files to the fsMap", () => {
  const fsMap = createDefaultMapFromNodeModules({})
  fsMap.set("index.ts", "console.log('Hi!'')")

  const system = createSystem(fsMap)
  const compilerOpts = {}
  const env = createVirtualTypeScriptEnvironment(system, ["index.ts"], ts, compilerOpts)
  const emitted = env.languageService.getProgram()?.emit()

  expect(emitted!.emitSkipped).toEqual(false)
  expect(Array.from(fsMap.keys())).toContain("index.js")
})

it("creates a map from the CDN without cache", async () => {
  const fetcher = jest.fn()
  fetcher.mockResolvedValue({ text: () => Promise.resolve("// Contents of file") })
  const store = jest.fn() as any

  const compilerOpts = { target: ts.ScriptTarget.ES5 }
  const libs = knownLibFilesForCompilerOptions(compilerOpts, ts)
  expect(libs.length).toBeGreaterThan(0)

  const map = await createDefaultMapFromCDN(compilerOpts, "3.7.3", false, ts, undefined, fetcher, store)
  expect(map.size).toBeGreaterThan(0)

  libs.forEach(l => {
    expect(map.get("/" + l)).toBeDefined()
  })
})

it("creates a map from the CDN and stores it in local storage cache", async () => {
  const fetcher = jest.fn()
  fetcher.mockResolvedValue({ text: () => Promise.resolve("// Contents of file") })

  const store: any = {
    getItem: jest.fn(),
    setItem: jest.fn(),
  }

  const compilerOpts = { target: ts.ScriptTarget.ES5 }
  const libs = knownLibFilesForCompilerOptions(compilerOpts, ts)
  expect(libs.length).toBeGreaterThan(0)

  const map = await createDefaultMapFromCDN(compilerOpts, "3.7.3", true, ts, undefined, fetcher, store)
  expect(map.size).toBeGreaterThan(0)

  libs.forEach(l => expect(map.get("/" + l)).toBeDefined())

  expect(store.setItem).toBeCalledTimes(libs.length)
})

it("creates a map from the CDN and uses the existing local storage cache", async () => {
  const fetcher = jest.fn()
  fetcher.mockResolvedValue({ text: () => Promise.resolve("// Contents of file") })

  const store: any = {
    getItem: jest.fn(),
    setItem: jest.fn(),
  }

  // Once return a value from the store
  store.getItem.mockReturnValueOnce("// From Cache")

  const compilerOpts = { target: ts.ScriptTarget.ES5 }
  const libs = knownLibFilesForCompilerOptions(compilerOpts, ts)
  expect(libs.length).toBeGreaterThan(0)

  const map = await createDefaultMapFromCDN(compilerOpts, "3.7.3", true, ts, undefined, fetcher, store)
  expect(map.size).toBeGreaterThan(0)

  libs.forEach(l => expect(map.get("/" + l)).toBeDefined())

  // Should be one less fetch, and the first item would be from the cache instead
  expect(store.setItem).toBeCalledTimes(libs.length - 1)
  expect(map.get("/" + libs[0])).toMatchInlineSnapshot(`"// From Cache"`)
})

describe(knownLibFilesForCompilerOptions, () => {
  it("handles blank", () => {
    const libs = knownLibFilesForCompilerOptions({}, ts)
    expect(libs.length).toBeGreaterThan(0)
  })

  it("handles a target", () => {
    const baseline = knownLibFilesForCompilerOptions({}, ts)
    const libs = knownLibFilesForCompilerOptions({ target: ts.ScriptTarget.ES2017 }, ts)
    expect(libs.length).toBeGreaterThan(baseline.length)
  })

  it("handles lib", () => {
    const baseline = knownLibFilesForCompilerOptions({}, ts)
    const libs = knownLibFilesForCompilerOptions({ lib: ["ES2020"] }, ts)
    expect(libs.length).toBeGreaterThan(baseline.length)
  })

  it("handles both", () => {
    const baseline = knownLibFilesForCompilerOptions({ target: ts.ScriptTarget.ES2016 }, ts)
    const libs = knownLibFilesForCompilerOptions({ lib: ["ES2020"], target: ts.ScriptTarget.ES2016 }, ts)
    expect(libs.length).toBeGreaterThan(baseline.length)
  })

  it("actually includes the right things", () => {
    const baseline = knownLibFilesForCompilerOptions({ target: ts.ScriptTarget.ES2016 }, ts)
    expect(baseline).toContain("lib.es2016.d.ts")
  })
})
