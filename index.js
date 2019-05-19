let lex = require('pug-lexer')
let parse = require('pug-parser')
let { CodeGenerator } = require('pug-code-gen')
let wrap = require('pug-runtime/wrap')

// Check if it's a normal tag, and then fix the svelte
// block styled attributes if needed. Also check if there
// is a pug block (plain text) following, so the renderer
// can skip unnecessary works
let _tag = /^([^(]*(\(?))(.*)/
let _tagWithBlock = /\.\s*$/
let _tagEnd = /^(.*)(\)([^'"}]*(?: +.*|$)))/
let _block = /^\.\s*$/
let _notTag = [
  /^[^\w#.]/,
  /^doctype/,
  /^(?:case|when|default)/,
  /^(?:if|else|each|while)/,
  /^(?:include|block|extends|append|mixin)/,
  _block
]

function parseTag (str) {
  for (let e of _notTag)
    if (e.test(str)) return false

  let cap = str.match(_tag)
  let data = parseTagEnd(cap[3])
  return {
    ...data,
    pre: cap[1],
    hasTagEnd: !cap[2] || data.hasTagEnd,
    hasBlock: cap[2] ? data.hasBlock : _tagWithBlock.test(cap[1])
  }
}

function parseTagEnd (str) {
  let cap = str.match(_tagEnd)
  return {
    attrs: cap ? cap[1] : str,
    post: cap ? cap[2] : '',
    hasTagEnd: cap,
    hasBlock: cap ? _block.test(cap[3]) : false
  }
}

// Wrap svelte block styled attributes with
// quotes so pug can parse them, because the
// normal behavious of pug is to throw errors
let _attrs = /(?::?\w[\w-:]*|'.+?'|".+?")=(?:\w+|'.+?'|".+?"|{.*?})|'.+?'|".+?"|{.+?}|:?\w[\w-:]*/g
let _attrBlock = /^{.+}$/
let _attrValBlock = /^(.+=)({.+})$/

function parseAttrs (str) {
  let attrs = str.match(_attrs) || []

  attrs.forEach((e, i) => {
    if (_attrBlock.test(e)) {
      attrs[i] = `'${e}'`
    } else {
      let cap = e.match(_attrValBlock)
      cap && (attrs[i] = `${cap[1]}'${cap[2]}'`)
    }
  })

  return attrs.join(' ').trim()
}

// Check if it's a svelte block, and
// parse the block info
let _sBlock = /^{([#:])(.+) ?.*/

function parseSBlock (str) {
  let cap = str.match(_sBlock)
  return !cap
    ? false
    : {
      type: cap[2],
      newSBlock: cap[1] === '#'
    }
}

// Preprocess the svelte-pug template in the format
// that pug can parse without throwing errors
function preprocess (str) {
  let rt = ''
  let sBlocks = [] // svelte blocks
  let toCloseSBlocks
  let tab
  let inTag
  let blockIndent // normal pug plain text block

  // func to close svelte blocks which are outdented
  let closeSBlocks = () => {
    for (let e of toCloseSBlocks) {
      rt += `${e.indent}| {/${e.type}\n`
      sBlocks.pop()
    }
  }

  // process line by line
  for (let line of str.match(/^.*$/gm)) {
    let cap = line.match(/^([ \t]*)(.*)$/)
    let indent = cap[1]
    let lineData = cap[2]

    // try to init tab size
    if (!tab) {
      if (indent[0] === ' ') tab = 2
      else if (indent[0] === '/t') tab = 1
    }

    // correct indent and set up
    // the svelte blocks to be closed
    toCloseSBlocks = []
    for (let e of sBlocks) {
      if (indent > e.indent)
        indent = indent.slice(tab)
      else
        toCloseSBlocks.unshift(e)
    }

    // if currently inside a block:
    // just copy paste
    if (blockIndent) {
      if (indent > blockIndent) {
        rt += line + '\n'
        continue
      } else { blockIndent = false }
    }

    // if currently inside a tag:
    // fix svelte typed attributes and
    // check if tag end
    if (inTag) {
      let data = parseTagEnd(lineData)
      let attrs = parseAttrs(data.attrs)
      rt += indent + attrs + data.post + '\n'
      data.hasTagEnd && (inTag = false)
      data.hasBlock && (blockIndent = indent.slice(tab))
      continue
    }

    // if it's a tag:
    // fix svelte typed attributes and
    // check if the tag extends to next lines
    let data = parseTag(lineData)
    if (data) {
      closeSBlocks()

      let attrs = parseAttrs(data.attrs)
      rt += indent + data.pre + attrs + data.post + '\n'
      data.hasTagEnd || (inTag = true)
      data.hasBlock && (blockIndent = indent)
      continue
    }

    // if it's a svelte block:
    // change block to pug plain text and
    // add to block stack if needed
    data = parseSBlock(lineData)
    if (data) {
      if (data.newSBlock) {
        closeSBlocks()
        sBlocks.push({
          type: data.type,
          indent
        })
      }
      rt += indent + '| ' + lineData + '\n'
      continue
    }

    // if it's another pug object:
    // just copy paste
    rt += line + '\n'

    // check if it's a plain text block
    _block.test(lineData) && (blockIndent = indent)
  }

  return rt
}

// Render a svelte-pug template into html
let attrs = CodeGenerator.prototype.attrs

function render (str, { pretty } = {}) {
  let gen = new CodeGenerator(parse(lex(preprocess(str))), { pretty })
  gen.attrs = function () {
    this.terse = true
    return attrs.call(this, ...arguments)
  }
  return wrap(gen.compile())()
}

exports.render = render

console.log(render(`
p
  .
    let a = 0
    b = 3


let a = 0
a + 1
`, { pretty: false }))