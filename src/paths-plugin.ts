import { setupTs, readConfigFile } from './instance'
import { LoaderConfig } from './interfaces'
import * as path from 'path'
import * as _ from 'lodash'
import * as ts from 'typescript'

const ModulesInRootPlugin: new (
	a: string,
	b: string,
	c: string
) => ResolverPlugin = require('enhanced-resolve/lib/ModulesInRootPlugin')

const createInnerCallback: CreateInnerCallback = require('enhanced-resolve/lib/createInnerCallback')
const getInnerRequest: getInnerRequest = require('enhanced-resolve/lib/getInnerRequest')

type CreateInnerCallback = (
	callback: Callback,
	options: Callback,
	message?: string,
	messageOptional?: string
) => Callback
type getInnerRequest = (resolver: Resolver, request: Request) => string

export interface Request {
	request?: Request
	relativePath: string
}

export interface Callback {
	(err?: Error, result?: any): void

	log?: any
	stack?: any
	missing?: any
}

export type ResolverCallback = (request: Request, callback: Callback) => void

export interface ResolverPlugin {
	apply(resolver: Resolver): void
}

export interface Resolver {
	apply(plugin: ResolverPlugin): void
	plugin(source: string, cb: ResolverCallback)
	doResolve(target: string, req: Request, desc: string, Callback)
	join(relativePath: string, innerRequest: Request): Request
}

export interface Mapping {
	onlyModule: boolean
	alias: string
	aliasPattern: RegExp
	target: string
}

function escapeRegExp(str) {
	return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')
}

export interface PathPluginOptions {
	context?: string
}

export class PathPlugin implements ResolverPlugin {
	source: string
	target: string
	ts: typeof ts
	configFilePath: string
	options: ts.CompilerOptions

	baseUrl: string
	mappings: Mapping[]
	absoluteBaseUrl: string

	constructor(config: LoaderConfig & ts.CompilerOptions & PathPluginOptions = {} as any) {
		this.source = 'described-resolve'
		this.target = 'resolve'

		this.ts = setupTs(config.compiler).tsImpl

		let context = config.context || process.cwd()
		let { configFilePath, compilerConfig } = readConfigFile(context, config, {}, this.ts)

		this.options = compilerConfig.options
		this.configFilePath = configFilePath

		this.baseUrl = this.options.baseUrl
		this.absoluteBaseUrl = path.resolve(path.dirname(this.configFilePath), this.baseUrl || '.')

		this.mappings = []
		let paths = this.options.paths || {}
		Object.keys(paths).forEach(alias => {
			let onlyModule = alias.indexOf('*') === -1
			let excapedAlias = escapeRegExp(alias)
			let targets = paths[alias]
			targets.forEach(target => {
				let aliasPattern: RegExp
				if (onlyModule) {
					aliasPattern = new RegExp(`^${excapedAlias}$`)
				} else {
					let withStarCapturing = excapedAlias.replace('\\*', '(.*)')
					aliasPattern = new RegExp(`^${withStarCapturing}`)
				}

				this.mappings.push({
					onlyModule,
					alias,
					aliasPattern,
					target: target
				})
			})
		})
	}

	apply(resolver: Resolver) {
		let { baseUrl, mappings } = this

		if (baseUrl) {
			resolver.apply(new ModulesInRootPlugin('module', this.absoluteBaseUrl, 'resolve'))
		}

		mappings.forEach(mapping => {
			// skip "phantom" type references
			if (!this.isTyping(mapping.target)) {
				resolver.plugin(this.source, this.createPlugin(resolver, mapping))
			}
		})
	}

	isTyping(target: string) {
		return target.indexOf('@types') !== -1 || target.indexOf('.d.ts') !== -1
	}

	createPlugin(resolver: Resolver, mapping: Mapping) {
		return (request, callback) => {
			let innerRequest = getInnerRequest(resolver, request)
			if (!innerRequest) {
				return callback()
			}

			let match = innerRequest.match(mapping.aliasPattern)
			if (!match) {
				return callback()
			}

			let newRequestStr = mapping.target
			if (!mapping.onlyModule) {
				newRequestStr = newRequestStr.replace('*', match[1])
			}

			if (newRequestStr[0] === '.') {
				newRequestStr = path.resolve(this.absoluteBaseUrl, newRequestStr)
			}

			let newRequest = _.extend({}, request, {
				request: newRequestStr
			}) as Request

			return resolver.doResolve(
				this.target,
				newRequest,
				"aliased with mapping '" +
					innerRequest +
					"': '" +
					mapping.alias +
					"' to '" +
					newRequestStr +
					"'",
				createInnerCallback(function(err, result) {
					if (arguments.length > 0) {
						return callback(err, result)
					}

					// don't allow other aliasing or raw request
					callback(null, null)
				}, callback)
			)
		}
	}
}
