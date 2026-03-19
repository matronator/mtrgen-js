export interface BaseMatch {
    all?: string;
}

export interface VariableMatch extends BaseMatch {
    // full match =>             // <% var='default'|filter:10,'arg','another' %>
    variable?: string;           // var
    default?: string;            // ='default'
    filterFull?: string;         // |filter:10,'arg','another'
    filter?: string;             // filter
}

export type ConditionOperator = "<=" | "<" | "===" | "==" | ">=" | ">" | "!==" | "!=";

export interface ConditionMatch extends BaseMatch {
    // full match =>                 // <% if !a > 10 %>
    condition?: string;              // !a > 10
    negation?: string;               // !
    left?: string;                   // a
    operator?: ConditionOperator;    // >
    right?: string;                  // 10
}

export interface CommentMatch extends BaseMatch {
    // full match =>            // <# comment #>
    comment?: string;            // comment
}
