"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaselineUsers = void 0;
const pulumi = __importStar(require("@pulumi/pulumi"));
const aws = __importStar(require("@pulumi/aws"));
class BaselineUsers extends pulumi.ComponentResource {
    constructor(name, args, opts) {
        var _a;
        super('cloud-baseline:iam:BaselineUsers', name, args, opts);
        this.initialPasswords = {};
        const protect = (_a = args.preserveOnDestroy) !== null && _a !== void 0 ? _a : false;
        for (const userConfig of args.users) {
            if (userConfig.create) {
                const user = new aws.iam.User(`admin-user-${userConfig.name}`, {
                    name: userConfig.name,
                    forceDestroy: true,
                }, { parent: this, protect });
                const loginProfile = new aws.iam.UserLoginProfile(`admin-login-profile-${userConfig.name}`, {
                    user: user.name,
                    passwordResetRequired: true,
                }, { parent: this });
                this.initialPasswords[userConfig.name] = loginProfile.password;
            }
        }
        this.registerOutputs({
            initialPasswords: this.initialPasswords,
        });
    }
}
exports.BaselineUsers = BaselineUsers;
//# sourceMappingURL=BaselineUsers.js.map