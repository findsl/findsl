/**
 * Dependency-Injection-Modul für FinDSL.
 *
 * Hier werden Sprachdienste (Validator, Scope-Provider, Type-Computer,
 * Formatter, ...) registriert. Langium nutzt diese Bindings bei der
 * Erstellung der Services.
 */

import { type Module, inject } from 'langium';
import {
    type DefaultSharedModuleContext,
    type LangiumServices,
    type LangiumSharedServices,
    type PartialLangiumServices,
    type PartialLangiumSharedServices,
    createDefaultModule,
    createDefaultSharedModule,
} from 'langium/lsp';
import { FindslGeneratedModule, FindslGeneratedSharedModule } from './generated/module.js';
import { FindslValidator, registerValidationChecks } from './findsl-validator.js';
import { FindslHoverProvider } from './findsl-hover.js';
import { FindslDefinitionProvider } from './findsl-definition.js';
import { FindslTypeDefinitionProvider } from './findsl-type-definition.js';
import { FindslCallHierarchyProvider } from './findsl-call-hierarchy.js';
import { FindslSemanticTokenProvider } from './findsl-semantic-tokens.js';
import { FindslInlayHintProvider } from './findsl-inlay-hints.js';
import { FindslCodeLensProvider } from './findsl-codelens.js';
import { FindslSignatureHelpProvider } from './findsl-signature-help.js';
import { FindslDocumentLinkProvider } from './findsl-document-link.js';
import { FindslFormatter } from './findsl-formatter.js';
import { FindslExecuteCommandHandler } from './findsl-commands.js';
import { FindslReferencesProvider } from './findsl-references.js';
import { FindslRenameProvider } from './findsl-rename.js';
import { FindslDocumentHighlightProvider } from './findsl-highlight.js';
import { FindslFoldingRangeProvider } from './findsl-folding.js';
import { FindslDocumentSymbolProvider } from './findsl-symbols.js';
import { FindslCodeActionProvider } from './findsl-codeaction.js';
import { FindslCompletionProvider } from './findsl-completion.js';
import { FindslWorkspaceSymbolProvider } from './findsl-workspace-symbols.js';
import { FindslTokenBuilder } from './findsl-token-builder.js';
import { FindslDocumentValidator } from './findsl-document-validator.js';

/**
 * Sprach-spezifische Service-Erweiterungen für FinDSL.
 * Hier kommen Type-Checker, Scope-Provider, Code-Action-Provider etc. hin.
 */
export type FindslAddedServices = {
    validation: {
        FindslValidator: FindslValidator;
    };
};

/**
 * Vereinigung der Standard-Langium-Services mit unseren FinDSL-Erweiterungen.
 */
export type FindslServices = LangiumServices & FindslAddedServices;

/**
 * Konkrete DI-Bindings für FinDSL-Services.
 */
export const FindslModule: Module<FindslServices, PartialLangiumServices & FindslAddedServices> = {
    parser: {
        TokenBuilder: () => new FindslTokenBuilder(),
    },
    validation: {
        FindslValidator: (services) => new FindslValidator(services),
        DocumentValidator: (services) => new FindslDocumentValidator(services),
    },
    lsp: {
        HoverProvider:      (services) => new FindslHoverProvider(services),
        DefinitionProvider: (services) => new FindslDefinitionProvider(services),
        TypeProvider:       (services) => new FindslTypeDefinitionProvider(services),
        ReferencesProvider: (services) => new FindslReferencesProvider(services),
        RenameProvider:     (services) => new FindslRenameProvider(services),
        DocumentHighlightProvider: (services) => new FindslDocumentHighlightProvider(services),
        FoldingRangeProvider: (services) => new FindslFoldingRangeProvider(services),
        DocumentSymbolProvider: () => new FindslDocumentSymbolProvider(),
        CodeActionProvider: () => new FindslCodeActionProvider(),
        CompletionProvider: (services) => new FindslCompletionProvider(services),
        CallHierarchyProvider: (services) => new FindslCallHierarchyProvider(services),
        SemanticTokenProvider: (services) => new FindslSemanticTokenProvider(services),
        InlayHintProvider: (services) => new FindslInlayHintProvider(services),
        CodeLensProvider: () => new FindslCodeLensProvider(),
        SignatureHelp: (services) => new FindslSignatureHelpProvider(services),
        DocumentLinkProvider: (services) => new FindslDocumentLinkProvider(services),
        Formatter: () => new FindslFormatter(),
    },
};

/**
 * Shared-LSP-Bindings: der WorkspaceSymbolProvider lebt — anders als die
 * sprach-lokalen Provider — in den geteilten Services (workspace-weit,
 * sprachübergreifend).
 */
export const FindslSharedModule: Module<LangiumSharedServices, PartialLangiumSharedServices> = {
    lsp: {
        WorkspaceSymbolProvider: (services) => new FindslWorkspaceSymbolProvider(services),
        ExecuteCommandHandler: (services) => new FindslExecuteCommandHandler(services),
    },
};

/**
 * Erzeugt die kompletten Langium- und FinDSL-spezifischen Services
 * und registriert die Validation-Checks.
 */
export function createFindslServices(context: DefaultSharedModuleContext): {
    shared: LangiumSharedServices;
    Findsl: FindslServices;
} {
    const shared = inject(
        createDefaultSharedModule(context),
        FindslGeneratedSharedModule,
        FindslSharedModule,
    );
    const Findsl = inject(
        createDefaultModule({ shared }),
        FindslGeneratedModule,
        FindslModule,
    );
    shared.ServiceRegistry.register(Findsl);
    registerValidationChecks(Findsl);
    return { shared, Findsl };
}
