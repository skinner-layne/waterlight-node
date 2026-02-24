export type Role = 'system' | 'user' | 'assistant' | 'tool';
export interface Message {
    role: Role;
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
}
export interface FunctionCall {
    name: string;
    arguments: string;
}
export interface ToolCall {
    id: string;
    type: 'function';
    function: FunctionCall;
}
export interface Tool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
    };
}
export type ToolChoice = 'none' | 'auto' | {
    type: 'function';
    function: {
        name: string;
    };
};
export interface ChatCompletionCreateParams {
    model: string;
    messages: Message[];
    stream?: boolean;
    tools?: Tool[];
    tool_choice?: ToolChoice;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop?: string | string[];
    presence_penalty?: number;
    frequency_penalty?: number;
    user?: string;
}
export interface Choice {
    index: number;
    message: Message;
    finish_reason: string | null;
}
export interface Usage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}
export interface ChatCompletion {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: Choice[];
    usage: Usage;
}
export interface Delta {
    role?: Role;
    content?: string | null;
    tool_calls?: ToolCall[];
}
export interface StreamChoice {
    index: number;
    delta: Delta;
    finish_reason: string | null;
}
export interface ChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: StreamChoice[];
}
export interface EmbeddingCreateParams {
    input: string | string[];
    model?: string;
    encoding_format?: string;
}
export interface Embedding {
    object: 'embedding';
    index: number;
    embedding: number[];
}
export interface EmbeddingResponse {
    object: 'list';
    data: Embedding[];
    model: string;
    usage: Usage;
}
export interface Model {
    id: string;
    object: 'model';
    created: number;
    owned_by: string;
}
export interface ModelList {
    object: 'list';
    data: Model[];
}
