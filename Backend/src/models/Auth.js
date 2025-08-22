import mongoose from "mongoose";

const MsIdentitySchema = new mongoose.Schema(
  {
    oid: { type: String, required: true }, // Microsoft user object id
    tid: { type: String, required: true }, // Tenant id (university)
    sub: { type: String }, // Subject claim (per app)
    upn: { type: String }, // user@kmutt.ac.th
    preferredUsername: { type: String }, // often same as UPN
    name: { type: String }, // display name
  },
  { _id: false }
);
const MembershipSchema = new mongoose.Schema(
  {
    swarm: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Swarm",
      required: true,
    },
    role: { type: String, enum: ["user", "provider"], default: null },
    quotaBytes: { type: Number, default: null },
  },
  { _id: false, timestamps: true }
);

const authSchema = new mongoose.Schema(
  {
    ms: { type: MsIdentitySchema, required: true },
    email: { type: String, index: true },
    username: { type: String, required: true },
    memberships: { type: [MembershipSchema], default: [] },
    peerId: { type: String, default: null, index: true },
    activeSwarm: { // Currently active swarm for this user
      type: mongoose.Schema.Types.ObjectId,
      ref: "Swarm",
      default: null,
    },
  },
  { timestamps: true }
);

authSchema.index({ 'ms.oid': 1, 'ms.tid': 1 }, { unique: true, name: 'uniq_user_per_tenant' });


/**
* Helper: find a membership by swarm id.
*/
authSchema.methods.getMembership = function (swarmId) {
const sid = String(swarmId);
return this.memberships.find(m => String(m.swarm) === sid) || null;
};

export default mongoose.model('Auth', authSchema);
