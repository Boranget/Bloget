import fsPromises from 'fs/promises'
import path from 'path'
import log from 'electron-log'
import iconv from 'iconv-lite'
import { LINE_ENDING_REG, LF_LINE_ENDING_REG, CRLF_LINE_ENDING_REG } from '../config'
import { isDirectory2 } from 'common/filesystem'
import { isMarkdownFile } from 'common/filesystem/paths'
import { normalizeAndResolvePath, writeFile } from '../filesystem'
import { guessEncoding } from './encoding'
import yaml from 'js-yaml'
import moment from 'moment'

/**
 * 获取行尾替换字符的方法
 * @param {*} lineEnding 行尾字符？
 * @returns 返回当前设置的行尾字符
 */
const getLineEnding = lineEnding => {
  if (lineEnding === 'lf') {
    return '\n'
  } else if (lineEnding === 'crlf') {
    return '\r\n'
  }

  // This should not happend but use fallback value.
  log.error(`Invalid end of line character: expected "lf" or "crlf" but got "${lineEnding}".`)
  return '\n'
}

/**
 * 使用正则表达式替换行尾字符
 * @param {*} text 一行内容或者所有内容
 * @param {*} lineEnding 行尾字符设置
 * @returns 转换结果应该是
 */
const convertLineEndings = (text, lineEnding) => {
  return text.replace(LINE_ENDING_REG, getLineEnding(lineEnding))
}

/**
 * 转换文件路径的方法
 * Special function to normalize directory and markdown file paths.
 *
 * @param {string} pathname The path to the file or directory.
 * @returns {{isDir: boolean, path: string}?} Returns the normalize path and a
 * directory hint or null if it's not a directory or markdown file.
 */
export const normalizeMarkdownPath = pathname => {
  const isDir = isDirectory2(pathname)
  if (isDir || isMarkdownFile(pathname)) {
    // Normalize and resolve the path or link target.
    const resolved = normalizeAndResolvePath(pathname)
    if (resolved) {
      return { isDir, path: resolved }
    } else {
      console.error(`[ERROR] Cannot resolve "${pathname}".`)
    }
  }
  return null
}

/**
 * Write the content into a file.
 * 这里好像是只保存md文件会用到的接口
 * @param {string} pathname The path to the file.
 * @param {string} content The buffer to save.
 * @param {IMarkdownDocumentOptions} options The markdown document options
 */
export const writeMarkdownFile = (pathname, content, options) => {
  const { adjustLineEndingOnSave, lineEnding } = options
  const { encoding, isBom } = options.encoding
  const extension = path.extname(pathname) || '.md'

  // 在这里可以做更新日期的更新和多余图片的删除

  // 日期更新
  const threePointStr = '---\n'
  let firstThreePointIndex = content.indexOf(threePointStr)
  let secondThreePointIndex = content.indexOf(threePointStr, firstThreePointIndex + 4)
  // 判断是否以FrontMatter开头
  if (content.startsWith(threePointStr) && firstThreePointIndex !== -1 && secondThreePointIndex !== -1) {
    let configYamlStr = content.slice(firstThreePointIndex + 4, secondThreePointIndex)
    const configYaml = yaml.load(configYamlStr)
    // 获取创建时间
    let dateConfig = new Date(configYaml.date)
    // 时区差距调整
    dateConfig.setTime(dateConfig.getTime() - 1000 * 60 * 60 * 8)
    configYaml.date = moment(dateConfig).format('YYYY-MM-DD HH:mm:ss')
    // 生成更新时间
    configYaml.updated = moment().format('YYYY-MM-DD HH:mm:ss')

    let formatConfig = {
      title: '',
      date: '',
      updated: '',
      tags: '',
      categories: ''

    }
    Object.assign(formatConfig, configYaml)
    let replaceFrontMatter = yaml.dump(formatConfig)
    content = `---\n${replaceFrontMatter}---\n${content.slice(secondThreePointIndex + 4)}`
  }

  // 这里做了LF CRLF的转换
  if (adjustLineEndingOnSave) {
    content = convertLineEndings(content, lineEnding)
  }
  // 用了个buffer存储处理后的内容
  const buffer = iconv.encode(content, encoding, { addBOM: isBom })

  // 存的是buffer
  // TODO(@fxha): "safeSaveDocuments" using temporary file and rename syscall.
  return writeFile(pathname, buffer, extension, undefined)
}

/**
 * 读取md文件内容
 * Reads the contents of a markdown file.
 *
 * @param {string} pathname The path to the markdown file.
 * @param {string} preferredEol The preferred EOL.
 * @param {boolean} autoGuessEncoding Whether we should try to auto guess encoding.
 * @param {*} trimTrailingNewline The trim trailing newline option.
 * @returns {IMarkdownDocumentRaw} Returns a raw markdown document.
 */
export const loadMarkdownFile = async (pathname, preferredEol, autoGuessEncoding = true, trimTrailingNewline = 2) => {
  // TODO: Use streams to not buffer the file multiple times and only guess
  //       encoding on the first 256/512 bytes.

  // 获取输入buffer
  let buffer = await fsPromises.readFile(path.resolve(pathname))
  // 获取文件编码
  const encoding = guessEncoding(buffer, autoGuessEncoding)
  // 判断是否支持该编码
  const supported = iconv.encodingExists(encoding.encoding)
  // 不支持则报错
  if (!supported) {
    throw new Error(`"${encoding.encoding}" encoding is not supported.`)
  }

  // 进行解码
  let markdown = iconv.decode(buffer, encoding.encoding)

  // 判断行尾字符
  // Detect line ending
  const isLf = LF_LINE_ENDING_REG.test(markdown)
  const isCrlf = CRLF_LINE_ENDING_REG.test(markdown)
  const isMixedLineEndings = isLf && isCrlf
  const isUnknownEnding = !isLf && !isCrlf
  let lineEnding = preferredEol
  if (isLf && !isCrlf) {
    lineEnding = 'lf'
  } else if (isCrlf && !isLf) {
    lineEnding = 'crlf'
  }

  let adjustLineEndingOnSave = false
  if (isMixedLineEndings || isUnknownEnding || lineEnding !== 'lf') {
    adjustLineEndingOnSave = lineEnding !== 'lf'
    // Convert to LF for internal use.
    markdown = convertLineEndings(markdown, 'lf')
  }

  // Detect final newline
  if (trimTrailingNewline === 2) {
    if (!markdown) {
      // Use default value
      trimTrailingNewline = 3
    } else {
      const lastIndex = markdown.length - 1
      if (lastIndex >= 1 && markdown[lastIndex] === '\n' && markdown[lastIndex - 1] === '\n') {
        // Disabled
        trimTrailingNewline = 2
      } else if (markdown[lastIndex] === '\n') {
        // Ensure single trailing newline
        trimTrailingNewline = 1
      } else {
        // Trim trailing newlines
        trimTrailingNewline = 0
      }
    }
  }

  const filename = path.basename(pathname)

  return {
    // document information
    markdown,
    filename,
    pathname,

    // options
    encoding,
    lineEnding,
    adjustLineEndingOnSave,
    trimTrailingNewline,

    // raw file information
    isMixedLineEndings
  }
}
