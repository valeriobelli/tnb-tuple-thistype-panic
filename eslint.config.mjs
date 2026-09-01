import tseslint from 'typescript-eslint'

export default [
	{
		files: ['**/*.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
		plugins: { '@typescript-eslint': tseslint.plugin },
		// Any type-aware rule that calls checker.getTypeAtLocation() on the
		// array-literal default is enough; no-unsafe-assignment is the smallest one.
		rules: { '@typescript-eslint/no-unsafe-assignment': 'error' },
	},
]
