var aa = [1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1];

var ba = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

var ca = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4];

function CPU_X86() {
    var i, da;
    this.regs = new Array();
    for (i = 0; i < 8; i++) { this.regs[i] = 0;} //8 registers
    this.eip = 0;
    this.cc_op = 0;
    this.cc_dst = 0;
    this.cc_src = 0;
    this.cc_op2 = 0;
    this.cc_dst2 = 0;
    this.df = 1;
    this.eflags = 0x2;
    this.cycle_count = 0;
    this.hard_irq = 0;
    this.hard_intno = -1;
    this.cpl = 0;
    this.cr0 = (1 << 0);
    this.cr2 = 0;
    this.cr3 = 0;
    this.cr4 = 0;
    this.idt = {base: 0,limit: 0};
    this.gdt = {base: 0,limit: 0};

    this.segs = new Array();
    for (i = 0; i < 7; i++) {this.segs[i] = {selector: 0, base: 0, limit: 0, flags: 0}; }
    this.segs[2].flags = (1 << 22);
    this.segs[1].flags = (1 << 22);

    this.tr = {selector: 0,base: 0,limit: 0,flags: 0};
    this.ldt = {selector: 0,base: 0,limit: 0,flags: 0};
    this.halted = 0;
    this.phys_mem = null;
    da = 0x100000;
    this.tlb_read_kernel  = new Int32Array(da);
    this.tlb_write_kernel = new Int32Array(da);
    this.tlb_read_user    = new Int32Array(da);
    this.tlb_write_user   = new Int32Array(da);
    for (i = 0; i < da; i++) {
        this.tlb_read_kernel[i]  = -1;
        this.tlb_write_kernel[i] = -1;
        this.tlb_read_user[i]    = -1;
        this.tlb_write_user[i]   = -1;
    }
    this.tlb_pages = new Int32Array(2048);
    this.tlb_pages_count = 0;
}

CPU_X86.prototype.phys_mem_resize = function(new_mem_size) {
    this.mem_size = new_mem_size;
    new_mem_size += ((15 + 3) & ~3);
    this.phys_mem = new ArrayBuffer(new_mem_size);
    this.phys_mem8 = new Uint8Array(this.phys_mem, 0, new_mem_size);
    this.phys_mem16 = new Uint16Array(this.phys_mem, 0, new_mem_size / 2);
    this.phys_mem32 = new Int32Array(this.phys_mem, 0, new_mem_size / 4);
};

CPU_X86.prototype.ld8_phys = function(fa) {    return this.phys_mem8[fa]; };
CPU_X86.prototype.st8_phys = function(fa, ga) {    this.phys_mem8[fa] = ga; };
CPU_X86.prototype.ld32_phys = function(fa) {    return this.phys_mem32[fa >> 2]; };
CPU_X86.prototype.st32_phys = function(fa, ga) {    this.phys_mem32[fa >> 2] = ga; };

CPU_X86.prototype.tlb_set_page = function(fa, ha, ia, ja) {
    var i, ga, j;
    ha &= -4096;
    fa &= -4096;
    ga = fa ^ ha;
    i = fa >>> 12;
    if (this.tlb_read_kernel[i] == -1) {
        if (this.tlb_pages_count >= 2048) {
            this.tlb_flush_all1((i - 1) & 0xfffff);
        }
        this.tlb_pages[this.tlb_pages_count++] = i;
    }
    this.tlb_read_kernel[i] = ga;
    if (ia) {
        this.tlb_write_kernel[i] = ga;
    } else {
        this.tlb_write_kernel[i] = -1;
    }
    if (ja) {
        this.tlb_read_user[i] = ga;
        if (ia) {
            this.tlb_write_user[i] = ga;
        } else {
            this.tlb_write_user[i] = -1;
        }
    } else {
        this.tlb_read_user[i] = -1;
        this.tlb_write_user[i] = -1;
    }
};

CPU_X86.prototype.tlb_flush_page = function(fa) {
    var i;
    i = fa >>> 12;
    this.tlb_read_kernel[i] = -1;
    this.tlb_write_kernel[i] = -1;
    this.tlb_read_user[i] = -1;
    this.tlb_write_user[i] = -1;
};

CPU_X86.prototype.tlb_flush_all = function() {
    var i, j, n, ka;
    ka = this.tlb_pages;
    n = this.tlb_pages_count;
    for (j = 0; j < n; j++) {
        i = ka[j];
        this.tlb_read_kernel[i] = -1;
        this.tlb_write_kernel[i] = -1;
        this.tlb_read_user[i] = -1;
        this.tlb_write_user[i] = -1;
    }
    this.tlb_pages_count = 0;
};

CPU_X86.prototype.tlb_flush_all1 = function(la) {
    var i, j, n, ka, ma;
    ka = this.tlb_pages;
    n = this.tlb_pages_count;
    ma = 0;
    for (j = 0; j < n; j++) {
        i = ka[j];
        if (i == la) {
            ka[ma++] = i;
        } else {
            this.tlb_read_kernel[i] = -1;
            this.tlb_write_kernel[i] = -1;
            this.tlb_read_user[i] = -1;
            this.tlb_write_user[i] = -1;
        }
    }
    this.tlb_pages_count = ma;
};

CPU_X86.prototype.write_string = function(fa, na) {
    var i;
    for (i = 0; i < na.length; i++) {
        this.st8_phys(fa++, na.charCodeAt(i) & 0xff);
    }
    this.st8_phys(fa, 0);
};

// Represents numeric value ga as n-digit HEX
function hex_rep(ga, n) {
    var i, s;
    var h = "0123456789ABCDEF";
    s = "";
    for (i = n - 1; i >= 0; i--) {
        s = s + h[(ga >>> (i * 4)) & 15];
    }
    return s;
}

function _4_bytes_(n) { return hex_rep(n, 8);} // Represents 8-hex bytes of n
function _2_bytes_(n) { return hex_rep(n, 2);} // Represents 4-hex bytes of n
function _1_byte_(n) { return hex_rep(n, 4);} // Represents 2-hex bytes of n

CPU_X86.prototype.dump_short = function() {
    console.log(" EIP=" + _4_bytes_(this.eip)    + " EAX=" + _4_bytes_(this.regs[0]) + " ECX=" + _4_bytes_(this.regs[1]) + " EDX=" + _4_bytes_(this.regs[2]) + " EBX=" + _4_bytes_(this.regs[3]));
    console.log(" EFL=" + _4_bytes_(this.eflags) + " ESP=" + _4_bytes_(this.regs[4]) + " EBP=" + _4_bytes_(this.regs[5]) + " ESI=" + _4_bytes_(this.regs[6]) + " EDI=" + _4_bytes_(this.regs[7]));
};

CPU_X86.prototype.dump = function() {
    var i, sa, na;
    var ta = [" ES", " CS", " SS", " DS", " FS", " GS", "LDT", " TR"];
    this.dump_short();
    console.log("TSC=" + _4_bytes_(this.cycle_count) + " OP=" + _2_bytes_(this.cc_op) + " SRC=" + _4_bytes_(this.cc_src) + " DST=" + _4_bytes_(this.cc_dst) + " OP2=" + _2_bytes_(this.cc_op2) + " DST2=" + _4_bytes_(this.cc_dst2));
    console.log("CPL=" + this.cpl + " CR0=" + _4_bytes_(this.cr0) + " CR2=" + _4_bytes_(this.cr2) + " CR3=" + _4_bytes_(this.cr3) + " CR4=" + _4_bytes_(this.cr4));
    na = "";
    for (i = 0; i < 8; i++) {
        if (i == 6)
            sa = this.ldt;
        else if (i == 7)
            sa = this.tr;
        else
            sa = this.segs[i];
        na += ta[i] + "=" + _1_byte_(sa.selector) + " " + _4_bytes_(sa.base) + " " + _4_bytes_(sa.limit) + " " + _1_byte_((sa.flags >> 8) & 0xf0ff);
        if (i & 1) {
            console.log(na);
            na = "";
        } else {
            na += " ";
        }
    }
    sa = this.gdt;
    na = "GDT=     " + _4_bytes_(sa.base) + " " + _4_bytes_(sa.limit) + "      ";
    sa = this.idt;
    na += "IDT=     " + _4_bytes_(sa.base) + " " + _4_bytes_(sa.limit);
    console.log(na);
};

CPU_X86.prototype.exec_internal = function(ua, va) {
    var cpu, fa, regs;
    var _src, _dst, _op, Ba, Ca;
    var Da, Ea, Fa, b, Ga, ga, Ha, Ia, Ja, Ka, La, Ma;
    var Na, Oa, Pa, Qa, Ra, Sa;
    var phys_mem8, Ua;
    var phys_mem16, phys_mem32;
    var tlb_read_kernel, tlb_write_kernel, tlb_read_user, tlb_write_user, bb, cb;
    function db() {
        var eb;
        fb(fa, 0, cpu.cpl == 3);
        eb = bb[fa >>> 12] ^ fa;
        return phys_mem8[eb];
    }
    function gb() {
        var Ua;
        return (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
    }
    function hb() {
        var ga;
        ga = gb();
        fa++;
        ga |= gb() << 8;
        fa--;
        return ga;
    }
    function ib() {
        var Ua;
        return (((Ua = bb[fa >>> 12]) | fa) & 1 ? hb() : phys_mem16[(fa ^ Ua) >> 1]);
    }
    function jb() {
        var ga;
        ga = gb();
        fa++;
        ga |= gb() << 8;
        fa++;
        ga |= gb() << 16;
        fa++;
        ga |= gb() << 24;
        fa -= 3;
        return ga;
    }
    function kb() {
        var Ua;
        return (((Ua = bb[fa >>> 12]) | fa) & 3 ? jb() : phys_mem32[(fa ^ Ua) >> 2]);
    }
    function lb() {
        var eb;
        fb(fa, 1, cpu.cpl == 3);
        eb = cb[fa >>> 12] ^ fa;
        return phys_mem8[eb];
    }
    function mb() {
        var eb;
        return ((eb = cb[fa >>> 12]) == -1) ? lb() : phys_mem8[fa ^ eb];
    }
    function nb() {
        var ga;
        ga = mb();
        fa++;
        ga |= mb() << 8;
        fa--;
        return ga;
    }
    function ob() {
        var eb;
        return ((eb = cb[fa >>> 12]) | fa) & 1 ? nb() : phys_mem16[(fa ^ eb) >> 1];
    }
    function pb() {
        var ga;
        ga = mb();
        fa++;
        ga |= mb() << 8;
        fa++;
        ga |= mb() << 16;
        fa++;
        ga |= mb() << 24;
        fa -= 3;
        return ga;
    }
    function qb() {
        var eb;
        return ((eb = cb[fa >>> 12]) | fa) & 3 ? pb() : phys_mem32[(fa ^ eb) >> 2];
    }
    function rb(ga) {
        var eb;
        fb(fa, 1, cpu.cpl == 3);
        eb = cb[fa >>> 12] ^ fa;
        phys_mem8[eb] = ga;
    }
    function sb(ga) {
        var Ua;
        {
            Ua = cb[fa >>> 12];
            if (Ua == -1) {
                rb(ga);
            } else {
                phys_mem8[fa ^ Ua] = ga;
            }
        }
        ;
    }
    function tb(ga) {
        sb(ga);
        fa++;
        sb(ga >> 8);
        fa--;
    }
    function ub(ga) {
        var Ua;
        {
            Ua = cb[fa >>> 12];
            if ((Ua | fa) & 1) {
                tb(ga);
            } else {
                phys_mem16[(fa ^ Ua) >> 1] = ga;
            }
        }
        ;
    }
    function vb(ga) {
        sb(ga);
        fa++;
        sb(ga >> 8);
        fa++;
        sb(ga >> 16);
        fa++;
        sb(ga >> 24);
        fa -= 3;
    }
    function wb(ga) {
        var Ua;
        {
            Ua = cb[fa >>> 12];
            if ((Ua | fa) & 3) {
                vb(ga);
            } else {
                phys_mem32[(fa ^ Ua) >> 2] = ga;
            }
        }
        ;
    }
    function xb() {
        var eb;
        fb(fa, 0, 0);
        eb = tlb_read_kernel[fa >>> 12] ^ fa;
        return phys_mem8[eb];
    }
    function yb() {
        var eb;
        return ((eb = tlb_read_kernel[fa >>> 12]) == -1) ? xb() : phys_mem8[fa ^ eb];
    }
    function zb() {
        var ga;
        ga = yb();
        fa++;
        ga |= yb() << 8;
        fa--;
        return ga;
    }
    function Ab() {
        var eb;
        return ((eb = tlb_read_kernel[fa >>> 12]) | fa) & 1 ? zb() : phys_mem16[(fa ^ eb) >> 1];
    }
    function Bb() {
        var ga;
        ga = yb();
        fa++;
        ga |= yb() << 8;
        fa++;
        ga |= yb() << 16;
        fa++;
        ga |= yb() << 24;
        fa -= 3;
        return ga;
    }
    function Cb() {
        var eb;
        return ((eb = tlb_read_kernel[fa >>> 12]) | fa) & 3 ? Bb() : phys_mem32[(fa ^ eb) >> 2];
    }
    function Db(ga) {
        var eb;
        fb(fa, 1, 0);
        eb = tlb_write_kernel[fa >>> 12] ^ fa;
        phys_mem8[eb] = ga;
    }
    function Eb(ga) {
        var eb;
        eb = tlb_write_kernel[fa >>> 12];
        if (eb == -1) {
            Db(ga);
        } else {
            phys_mem8[fa ^ eb] = ga;
        }
    }
    function Fb(ga) {
        Eb(ga);
        fa++;
        Eb(ga >> 8);
        fa--;
    }
    function Gb(ga) {
        var eb;
        eb = tlb_write_kernel[fa >>> 12];
        if ((eb | fa) & 1) {
            Fb(ga);
        } else {
            phys_mem16[(fa ^ eb) >> 1] = ga;
        }
    }
    function Hb(ga) {
        Eb(ga);
        fa++;
        Eb(ga >> 8);
        fa++;
        Eb(ga >> 16);
        fa++;
        Eb(ga >> 24);
        fa -= 3;
    }
    function Ib(ga) {
        var eb;
        eb = tlb_write_kernel[fa >>> 12];
        if ((eb | fa) & 3) {
            Hb(ga);
        } else {
            phys_mem32[(fa ^ eb) >> 2] = ga;
        }
    }
    var Jb, Kb, Lb, Mb, Nb;
    function Ob() {
        var ga, Ha;
        ga = phys_mem8[Kb++];
        ;
        Ha = phys_mem8[Kb++];
        ;
        return ga | (Ha << 8);
    }
    function Pb(Ea) {
        var base, fa, Qb, Rb, Sb, Tb;
        if (Qa && (Da & (0x000f | 0x0080)) == 0) {
            switch ((Ea & 7) | ((Ea >> 3) & 0x18)) {
                case 0x04:
                    Qb = phys_mem8[Kb++];
                    ;
                    base = Qb & 7;
                    if (base == 5) {
                        {
                            fa = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                            Kb += 4;
                        }
                        ;
                    } else {
                        fa = regs[base];
                    }
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        fa = (fa + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x0c:
                    Qb = phys_mem8[Kb++];
                    ;
                    fa = ((phys_mem8[Kb++] << 24) >> 24);
                    ;
                    base = Qb & 7;
                    fa = (fa + regs[base]) >> 0;
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        fa = (fa + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x14:
                    Qb = phys_mem8[Kb++];
                    ;
                    {
                        fa = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    base = Qb & 7;
                    fa = (fa + regs[base]) >> 0;
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        fa = (fa + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x05:
                    {
                        fa = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    break;
                case 0x00:
                case 0x01:
                case 0x02:
                case 0x03:
                case 0x06:
                case 0x07:
                    base = Ea & 7;
                    fa = regs[base];
                    break;
                case 0x08:
                case 0x09:
                case 0x0a:
                case 0x0b:
                case 0x0d:
                case 0x0e:
                case 0x0f:
                    fa = ((phys_mem8[Kb++] << 24) >> 24);
                    ;
                    base = Ea & 7;
                    fa = (fa + regs[base]) >> 0;
                    break;
                case 0x10:
                case 0x11:
                case 0x12:
                case 0x13:
                case 0x15:
                case 0x16:
                case 0x17:
                default:
                    {
                        fa = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    base = Ea & 7;
                    fa = (fa + regs[base]) >> 0;
                    break;
            }
            return fa;
        } else if (Da & 0x0080) {
            if ((Ea & 0xc7) == 0x06) {
                fa = Ob();
                Tb = 3;
            } else {
                switch (Ea >> 6) {
                    case 0:
                        fa = 0;
                        break;
                    case 1:
                        fa = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        break;
                    default:
                        fa = Ob();
                        break;
                }
                switch (Ea & 7) {
                    case 0:
                        fa = (fa + regs[3] + regs[6]) & 0xffff;
                        Tb = 3;
                        break;
                    case 1:
                        fa = (fa + regs[3] + regs[7]) & 0xffff;
                        Tb = 3;
                        break;
                    case 2:
                        fa = (fa + regs[5] + regs[6]) & 0xffff;
                        Tb = 2;
                        break;
                    case 3:
                        fa = (fa + regs[5] + regs[7]) & 0xffff;
                        Tb = 2;
                        break;
                    case 4:
                        fa = (fa + regs[6]) & 0xffff;
                        Tb = 3;
                        break;
                    case 5:
                        fa = (fa + regs[7]) & 0xffff;
                        Tb = 3;
                        break;
                    case 6:
                        fa = (fa + regs[5]) & 0xffff;
                        Tb = 2;
                        break;
                    case 7:
                    default:
                        fa = (fa + regs[3]) & 0xffff;
                        Tb = 3;
                        break;
                }
            }
            Sb = Da & 0x000f;
            if (Sb == 0) {
                Sb = Tb;
            } else {
                Sb--;
            }
            fa = (fa + cpu.segs[Sb].base) >> 0;
            return fa;
        } else {
            switch ((Ea & 7) | ((Ea >> 3) & 0x18)) {
                case 0x04:
                    Qb = phys_mem8[Kb++];
                    ;
                    base = Qb & 7;
                    if (base == 5) {
                        {
                            fa = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                            Kb += 4;
                        }
                        ;
                        base = 0;
                    } else {
                        fa = regs[base];
                    }
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        fa = (fa + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x0c:
                    Qb = phys_mem8[Kb++];
                    ;
                    fa = ((phys_mem8[Kb++] << 24) >> 24);
                    ;
                    base = Qb & 7;
                    fa = (fa + regs[base]) >> 0;
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        fa = (fa + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x14:
                    Qb = phys_mem8[Kb++];
                    ;
                    {
                        fa = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    base = Qb & 7;
                    fa = (fa + regs[base]) >> 0;
                    Rb = (Qb >> 3) & 7;
                    if (Rb != 4) {
                        fa = (fa + (regs[Rb] << (Qb >> 6))) >> 0;
                    }
                    break;
                case 0x05:
                    {
                        fa = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    base = 0;
                    break;
                case 0x00:
                case 0x01:
                case 0x02:
                case 0x03:
                case 0x06:
                case 0x07:
                    base = Ea & 7;
                    fa = regs[base];
                    break;
                case 0x08:
                case 0x09:
                case 0x0a:
                case 0x0b:
                case 0x0d:
                case 0x0e:
                case 0x0f:
                    fa = ((phys_mem8[Kb++] << 24) >> 24);
                    ;
                    base = Ea & 7;
                    fa = (fa + regs[base]) >> 0;
                    break;
                case 0x10:
                case 0x11:
                case 0x12:
                case 0x13:
                case 0x15:
                case 0x16:
                case 0x17:
                default:
                    {
                        fa = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    base = Ea & 7;
                    fa = (fa + regs[base]) >> 0;
                    break;
            }
            Sb = Da & 0x000f;
            if (Sb == 0) {
                if (base == 4 || base == 5)
                    Sb = 2;
                else
                    Sb = 3;
            } else {
                Sb--;
            }
            fa = (fa + cpu.segs[Sb].base) >> 0;
            return fa;
        }
    }
    function Ub() {
        var fa, Sb;
        if (Da & 0x0080) {
            fa = Ob();
        } else {
            {
                fa = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                Kb += 4;
            }
            ;
        }
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        fa = (fa + cpu.segs[Sb].base) >> 0;
        return fa;
    }
    function Vb(Ga, ga) {
        if (Ga & 4)
            regs[Ga & 3] = (regs[Ga & 3] & -65281) | ((ga & 0xff) << 8);
        else
            regs[Ga & 3] = (regs[Ga & 3] & -256) | (ga & 0xff);
    }
    function Wb(Ga, ga) {
        regs[Ga] = (regs[Ga] & -65536) | (ga & 0xffff);
    }
    function Xb(Ja, Yb, Zb) {
        var ac;
        switch (Ja) {
            case 0:
                _src = Zb;
                Yb = (Yb + Zb) >> 0;
                _dst = Yb;
                _op = 2;
                break;
            case 1:
                Yb = Yb | Zb;
                _dst = Yb;
                _op = 14;
                break;
            case 2:
                ac = bc();
                _src = Zb;
                Yb = (Yb + Zb + ac) >> 0;
                _dst = Yb;
                _op = ac ? 5 : 2;
                break;
            case 3:
                ac = bc();
                _src = Zb;
                Yb = (Yb - Zb - ac) >> 0;
                _dst = Yb;
                _op = ac ? 11 : 8;
                break;
            case 4:
                Yb = Yb & Zb;
                _dst = Yb;
                _op = 14;
                break;
            case 5:
                _src = Zb;
                Yb = (Yb - Zb) >> 0;
                _dst = Yb;
                _op = 8;
                break;
            case 6:
                Yb = Yb ^ Zb;
                _dst = Yb;
                _op = 14;
                break;
            case 7:
                _src = Zb;
                _dst = (Yb - Zb) >> 0;
                _op = 8;
                break;
            default:
                throw "arith" + cc + ": invalid op";
        }
        return Yb;
    }
    function dc(Ja, Yb, Zb) {
        var ac;
        switch (Ja) {
            case 0:
                _src = Zb;
                Yb = (((Yb + Zb) << 16) >> 16);
                _dst = Yb;
                _op = 1;
                break;
            case 1:
                Yb = (((Yb | Zb) << 16) >> 16);
                _dst = Yb;
                _op = 13;
                break;
            case 2:
                ac = bc();
                _src = Zb;
                Yb = (((Yb + Zb + ac) << 16) >> 16);
                _dst = Yb;
                _op = ac ? 4 : 1;
                break;
            case 3:
                ac = bc();
                _src = Zb;
                Yb = (((Yb - Zb - ac) << 16) >> 16);
                _dst = Yb;
                _op = ac ? 10 : 7;
                break;
            case 4:
                Yb = (((Yb & Zb) << 16) >> 16);
                _dst = Yb;
                _op = 13;
                break;
            case 5:
                _src = Zb;
                Yb = (((Yb - Zb) << 16) >> 16);
                _dst = Yb;
                _op = 7;
                break;
            case 6:
                Yb = (((Yb ^ Zb) << 16) >> 16);
                _dst = Yb;
                _op = 13;
                break;
            case 7:
                _src = Zb;
                _dst = (((Yb - Zb) << 16) >> 16);
                _op = 7;
                break;
            default:
                throw "arith" + cc + ": invalid op";
        }
        return Yb;
    }
    function ec(ga) {
        if (_op < 25) {
            Ba = _op;
            Ca = _dst;
        }
        _dst = (((ga + 1) << 16) >> 16);
        _op = 26;
        return _dst;
    }
    function fc(ga) {
        if (_op < 25) {
            Ba = _op;
            Ca = _dst;
        }
        _dst = (((ga - 1) << 16) >> 16);
        _op = 29;
        return _dst;
    }
    function gc(Ja, Yb, Zb) {
        var ac;
        switch (Ja) {
            case 0:
                _src = Zb;
                Yb = (((Yb + Zb) << 24) >> 24);
                _dst = Yb;
                _op = 0;
                break;
            case 1:
                Yb = (((Yb | Zb) << 24) >> 24);
                _dst = Yb;
                _op = 12;
                break;
            case 2:
                ac = bc();
                _src = Zb;
                Yb = (((Yb + Zb + ac) << 24) >> 24);
                _dst = Yb;
                _op = ac ? 3 : 0;
                break;
            case 3:
                ac = bc();
                _src = Zb;
                Yb = (((Yb - Zb - ac) << 24) >> 24);
                _dst = Yb;
                _op = ac ? 9 : 6;
                break;
            case 4:
                Yb = (((Yb & Zb) << 24) >> 24);
                _dst = Yb;
                _op = 12;
                break;
            case 5:
                _src = Zb;
                Yb = (((Yb - Zb) << 24) >> 24);
                _dst = Yb;
                _op = 6;
                break;
            case 6:
                Yb = (((Yb ^ Zb) << 24) >> 24);
                _dst = Yb;
                _op = 12;
                break;
            case 7:
                _src = Zb;
                _dst = (((Yb - Zb) << 24) >> 24);
                _op = 6;
                break;
            default:
                throw "arith" + cc + ": invalid op";
        }
        return Yb;
    }
    function hc(ga) {
        if (_op < 25) {
            Ba = _op;
            Ca = _dst;
        }
        _dst = (((ga + 1) << 24) >> 24);
        _op = 25;
        return _dst;
    }
    function ic(ga) {
        if (_op < 25) {
            Ba = _op;
            Ca = _dst;
        }
        _dst = (((ga - 1) << 24) >> 24);
        _op = 28;
        return _dst;
    }
    function jc(Ja, Yb, Zb) {
        var kc, ac;
        switch (Ja) {
            case 0:
                if (Zb & 0x1f) {
                    Zb &= 0x7;
                    Yb &= 0xff;
                    kc = Yb;
                    Yb = (Yb << Zb) | (Yb >>> (8 - Zb));
                    _src = lc();
                    _src |= (Yb & 0x0001) | (((kc ^ Yb) << 4) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 1:
                if (Zb & 0x1f) {
                    Zb &= 0x7;
                    Yb &= 0xff;
                    kc = Yb;
                    Yb = (Yb >>> Zb) | (Yb << (8 - Zb));
                    _src = lc();
                    _src |= ((Yb >> 7) & 0x0001) | (((kc ^ Yb) << 4) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 2:
                Zb = ca[Zb & 0x1f];
                if (Zb) {
                    Yb &= 0xff;
                    kc = Yb;
                    ac = bc();
                    Yb = (Yb << Zb) | (ac << (Zb - 1));
                    if (Zb > 1)
                        Yb |= kc >>> (9 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) << 4) & 0x0800) | ((kc >> (8 - Zb)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 3:
                Zb = ca[Zb & 0x1f];
                if (Zb) {
                    Yb &= 0xff;
                    kc = Yb;
                    ac = bc();
                    Yb = (Yb >>> Zb) | (ac << (8 - Zb));
                    if (Zb > 1)
                        Yb |= kc << (9 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) << 4) & 0x0800) | ((kc >> (Zb - 1)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 4:
            case 6:
                Zb &= 0x1f;
                if (Zb) {
                    _src = Yb << (Zb - 1);
                    _dst = Yb = (((Yb << Zb) << 24) >> 24);
                    _op = 15;
                }
                break;
            case 5:
                Zb &= 0x1f;
                if (Zb) {
                    Yb &= 0xff;
                    _src = Yb >>> (Zb - 1);
                    _dst = Yb = (((Yb >>> Zb) << 24) >> 24);
                    _op = 18;
                }
                break;
            case 7:
                Zb &= 0x1f;
                if (Zb) {
                    Yb = (Yb << 24) >> 24;
                    _src = Yb >> (Zb - 1);
                    _dst = Yb = (((Yb >> Zb) << 24) >> 24);
                    _op = 18;
                }
                break;
            default:
                throw "unsupported shift8=" + Ja;
        }
        return Yb;
    }
    function mc(Ja, Yb, Zb) {
        var kc, ac;
        switch (Ja) {
            case 0:
                if (Zb & 0x1f) {
                    Zb &= 0xf;
                    Yb &= 0xffff;
                    kc = Yb;
                    Yb = (Yb << Zb) | (Yb >>> (16 - Zb));
                    _src = lc();
                    _src |= (Yb & 0x0001) | (((kc ^ Yb) >> 4) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 1:
                if (Zb & 0x1f) {
                    Zb &= 0xf;
                    Yb &= 0xffff;
                    kc = Yb;
                    Yb = (Yb >>> Zb) | (Yb << (16 - Zb));
                    _src = lc();
                    _src |= ((Yb >> 15) & 0x0001) | (((kc ^ Yb) >> 4) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 2:
                Zb = ba[Zb & 0x1f];
                if (Zb) {
                    Yb &= 0xffff;
                    kc = Yb;
                    ac = bc();
                    Yb = (Yb << Zb) | (ac << (Zb - 1));
                    if (Zb > 1)
                        Yb |= kc >>> (17 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) >> 4) & 0x0800) | ((kc >> (16 - Zb)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 3:
                Zb = ba[Zb & 0x1f];
                if (Zb) {
                    Yb &= 0xffff;
                    kc = Yb;
                    ac = bc();
                    Yb = (Yb >>> Zb) | (ac << (16 - Zb));
                    if (Zb > 1)
                        Yb |= kc << (17 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) >> 4) & 0x0800) | ((kc >> (Zb - 1)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 4:
            case 6:
                Zb &= 0x1f;
                if (Zb) {
                    _src = Yb << (Zb - 1);
                    _dst = Yb = (((Yb << Zb) << 16) >> 16);
                    _op = 16;
                }
                break;
            case 5:
                Zb &= 0x1f;
                if (Zb) {
                    Yb &= 0xffff;
                    _src = Yb >>> (Zb - 1);
                    _dst = Yb = (((Yb >>> Zb) << 16) >> 16);
                    _op = 19;
                }
                break;
            case 7:
                Zb &= 0x1f;
                if (Zb) {
                    Yb = (Yb << 16) >> 16;
                    _src = Yb >> (Zb - 1);
                    _dst = Yb = (((Yb >> Zb) << 16) >> 16);
                    _op = 19;
                }
                break;
            default:
                throw "unsupported shift16=" + Ja;
        }
        return Yb;
    }
    function nc(Ja, Yb, Zb) {
        var kc, ac;
        switch (Ja) {
            case 0:
                Zb &= 0x1f;
                if (Zb) {
                    kc = Yb;
                    Yb = (Yb << Zb) | (Yb >>> (32 - Zb));
                    _src = lc();
                    _src |= (Yb & 0x0001) | (((kc ^ Yb) >> 20) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 1:
                Zb &= 0x1f;
                if (Zb) {
                    kc = Yb;
                    Yb = (Yb >>> Zb) | (Yb << (32 - Zb));
                    _src = lc();
                    _src |= ((Yb >> 31) & 0x0001) | (((kc ^ Yb) >> 20) & 0x0800);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 2:
                Zb &= 0x1f;
                if (Zb) {
                    kc = Yb;
                    ac = bc();
                    Yb = (Yb << Zb) | (ac << (Zb - 1));
                    if (Zb > 1)
                        Yb |= kc >>> (33 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) >> 20) & 0x0800) | ((kc >> (32 - Zb)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 3:
                Zb &= 0x1f;
                if (Zb) {
                    kc = Yb;
                    ac = bc();
                    Yb = (Yb >>> Zb) | (ac << (32 - Zb));
                    if (Zb > 1)
                        Yb |= kc << (33 - Zb);
                    _src = lc();
                    _src |= (((kc ^ Yb) >> 20) & 0x0800) | ((kc >> (Zb - 1)) & 0x0001);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                }
                break;
            case 4:
            case 6:
                Zb &= 0x1f;
                if (Zb) {
                    _src = Yb << (Zb - 1);
                    _dst = Yb = Yb << Zb;
                    _op = 17;
                }
                break;
            case 5:
                Zb &= 0x1f;
                if (Zb) {
                    _src = Yb >>> (Zb - 1);
                    _dst = Yb = Yb >>> Zb;
                    _op = 20;
                }
                break;
            case 7:
                Zb &= 0x1f;
                if (Zb) {
                    _src = Yb >> (Zb - 1);
                    _dst = Yb = Yb >> Zb;
                    _op = 20;
                }
                break;
            default:
                throw "unsupported shift32=" + Ja;
        }
        return Yb;
    }
    function oc(Ja, Yb, Zb, pc) {
        var qc;
        pc &= 0x1f;
        if (pc) {
            if (Ja == 0) {
                Zb &= 0xffff;
                qc = Zb | (Yb << 16);
                _src = qc >> (32 - pc);
                qc <<= pc;
                if (pc > 16)
                    qc |= Zb << (pc - 16);
                Yb = _dst = qc >> 16;
                _op = 19;
            } else {
                qc = (Yb & 0xffff) | (Zb << 16);
                _src = qc >> (pc - 1);
                qc >>= pc;
                if (pc > 16)
                    qc |= Zb << (32 - pc);
                Yb = _dst = (((qc) << 16) >> 16);
                _op = 19;
            }
        }
        return Yb;
    }
    function rc(Yb, Zb, pc) {
        pc &= 0x1f;
        if (pc) {
            _src = Yb << (pc - 1);
            _dst = Yb = (Yb << pc) | (Zb >>> (32 - pc));
            _op = 17;
        }
        return Yb;
    }
    function sc(Yb, Zb, pc) {
        pc &= 0x1f;
        if (pc) {
            _src = Yb >> (pc - 1);
            _dst = Yb = (Yb >>> pc) | (Zb << (32 - pc));
            _op = 20;
        }
        return Yb;
    }
    function tc(Yb, Zb) {
        Zb &= 0xf;
        _src = Yb >> Zb;
        _op = 19;
    }
    function uc(Yb, Zb) {
        Zb &= 0x1f;
        _src = Yb >> Zb;
        _op = 20;
    }
    function vc(Ja, Yb, Zb) {
        var wc;
        Zb &= 0xf;
        _src = Yb >> Zb;
        wc = 1 << Zb;
        switch (Ja) {
            case 1:
                Yb |= wc;
                break;
            case 2:
                Yb &= ~wc;
                break;
            case 3:
            default:
                Yb ^= wc;
                break;
        }
        _op = 19;
        return Yb;
    }
    function xc(Ja, Yb, Zb) {
        var wc;
        Zb &= 0x1f;
        _src = Yb >> Zb;
        wc = 1 << Zb;
        switch (Ja) {
            case 1:
                Yb |= wc;
                break;
            case 2:
                Yb &= ~wc;
                break;
            case 3:
            default:
                Yb ^= wc;
                break;
        }
        _op = 20;
        return Yb;
    }
    function yc(Yb, Zb) {
        Zb &= 0xffff;
        if (Zb) {
            Yb = 0;
            while ((Zb & 1) == 0) {
                Yb++;
                Zb >>= 1;
            }
            _dst = 1;
        } else {
            _dst = 0;
        }
        _op = 14;
        return Yb;
    }
    function zc(Yb, Zb) {
        if (Zb) {
            Yb = 0;
            while ((Zb & 1) == 0) {
                Yb++;
                Zb >>= 1;
            }
            _dst = 1;
        } else {
            _dst = 0;
        }
        _op = 14;
        return Yb;
    }
    function Ac(Yb, Zb) {
        Zb &= 0xffff;
        if (Zb) {
            Yb = 15;
            while ((Zb & 0x8000) == 0) {
                Yb--;
                Zb <<= 1;
            }
            _dst = 1;
        } else {
            _dst = 0;
        }
        _op = 14;
        return Yb;
    }
    function Bc(Yb, Zb) {
        if (Zb) {
            Yb = 31;
            while (Zb >= 0) {
                Yb--;
                Zb <<= 1;
            }
            _dst = 1;
        } else {
            _dst = 0;
        }
        _op = 14;
        return Yb;
    }
    function Cc(b) {
        var a, q, r;
        a = regs[0] & 0xffff;
        b &= 0xff;
        if ((a >> 8) >= b)
            Dc(0);
        q = (a / b) >> 0;
        r = (a % b);
        Wb(0, (q & 0xff) | (r << 8));
    }
    function Ec(b) {
        var a, q, r;
        a = (regs[0] << 16) >> 16;
        b = (b << 24) >> 24;
        if (b == 0)
            Dc(0);
        q = (a / b) >> 0;
        if (((q << 24) >> 24) != q)
            Dc(0);
        r = (a % b);
        Wb(0, (q & 0xff) | (r << 8));
    }
    function Fc(b) {
        var a, q, r;
        a = (regs[2] << 16) | (regs[0] & 0xffff);
        b &= 0xffff;
        if ((a >>> 16) >= b)
            Dc(0);
        q = (a / b) >> 0;
        r = (a % b);
        Wb(0, q);
        Wb(2, r);
    }
    function Gc(b) {
        var a, q, r;
        a = (regs[2] << 16) | (regs[0] & 0xffff);
        b = (b << 16) >> 16;
        if (b == 0)
            Dc(0);
        q = (a / b) >> 0;
        if (((q << 16) >> 16) != q)
            Dc(0);
        r = (a % b);
        Wb(0, q);
        Wb(2, r);
    }
    function Hc(Ic, Jc, b) {
        var a, i, Kc;
        Ic = Ic >>> 0;
        Jc = Jc >>> 0;
        b = b >>> 0;
        if (Ic >= b) {
            Dc(0);
        }
        if (Ic >= 0 && Ic <= 0x200000) {
            a = Ic * 4294967296 + Jc;
            Ma = (a % b) >> 0;
            return (a / b) >> 0;
        } else {
            for (i = 0; i < 32; i++) {
                Kc = Ic >> 31;
                Ic = ((Ic << 1) | (Jc >>> 31)) >>> 0;
                if (Kc || Ic >= b) {
                    Ic = Ic - b;
                    Jc = (Jc << 1) | 1;
                } else {
                    Jc = Jc << 1;
                }
            }
            Ma = Ic >> 0;
            return Jc;
        }
    }
    function Lc(Ic, Jc, b) {
        var Mc, Nc, q;
        if (Ic < 0) {
            Mc = 1;
            Ic = ~Ic;
            Jc = (-Jc) >> 0;
            if (Jc == 0)
                Ic = (Ic + 1) >> 0;
        } else {
            Mc = 0;
        }
        if (b < 0) {
            b = (-b) >> 0;
            Nc = 1;
        } else {
            Nc = 0;
        }
        q = Hc(Ic, Jc, b);
        Nc ^= Mc;
        if (Nc) {
            if ((q >>> 0) > 0x80000000)
                Dc(0);
            q = (-q) >> 0;
        } else {
            if ((q >>> 0) >= 0x80000000)
                Dc(0);
        }
        if (Mc) {
            Ma = (-Ma) >> 0;
        }
        return q;
    }
    function Oc(a, b) {
        var qc;
        a &= 0xff;
        b &= 0xff;
        qc = (regs[0] & 0xff) * (b & 0xff);
        _src = qc >> 8;
        _dst = (((qc) << 24) >> 24);
        _op = 21;
        return qc;
    }
    function Pc(a, b) {
        var qc;
        a = (((a) << 24) >> 24);
        b = (((b) << 24) >> 24);
        qc = (a * b) >> 0;
        _dst = (((qc) << 24) >> 24);
        _src = (qc != _dst) >> 0;
        _op = 21;
        return qc;
    }
    function Qc(a, b) {
        var qc;
        qc = ((a & 0xffff) * (b & 0xffff)) >> 0;
        _src = qc >>> 16;
        _dst = (((qc) << 16) >> 16);
        _op = 22;
        return qc;
    }
    function Rc(a, b) {
        var qc;
        a = (a << 16) >> 16;
        b = (b << 16) >> 16;
        qc = (a * b) >> 0;
        _dst = (((qc) << 16) >> 16);
        _src = (qc != _dst) >> 0;
        _op = 22;
        return qc;
    }
    function Sc(a, b) {
        var r, Jc, Ic, Tc, Uc, m;
        a = a >>> 0;
        b = b >>> 0;
        r = a * b;
        if (r <= 0xffffffff) {
            Ma = 0;
            r &= -1;
        } else {
            Jc = a & 0xffff;
            Ic = a >>> 16;
            Tc = b & 0xffff;
            Uc = b >>> 16;
            r = Jc * Tc;
            Ma = Ic * Uc;
            m = Jc * Uc;
            r += (((m & 0xffff) << 16) >>> 0);
            Ma += (m >>> 16);
            if (r >= 4294967296) {
                r -= 4294967296;
                Ma++;
            }
            m = Ic * Tc;
            r += (((m & 0xffff) << 16) >>> 0);
            Ma += (m >>> 16);
            if (r >= 4294967296) {
                r -= 4294967296;
                Ma++;
            }
            r &= -1;
            Ma &= -1;
        }
        return r;
    }
    function Vc(a, b) {
        _dst = Sc(a, b);
        _src = Ma;
        _op = 23;
        return _dst;
    }
    function Wc(a, b) {
        var s, r;
        s = 0;
        if (a < 0) {
            a = -a;
            s = 1;
        }
        if (b < 0) {
            b = -b;
            s ^= 1;
        }
        r = Sc(a, b);
        if (s) {
            Ma = ~Ma;
            r = (-r) >> 0;
            if (r == 0) {
                Ma = (Ma + 1) >> 0;
            }
        }
        _dst = r;
        _src = (Ma - (r >> 31)) >> 0;
        _op = 23;
        return r;
    }
    function bc() {
        var Yb, qc, Xc, Yc;
        if (_op >= 25) {
            Xc = Ba;
            Yc = Ca;
        } else {
            Xc = _op;
            Yc = _dst;
        }
        switch (Xc) {
            case 0:
                qc = (Yc & 0xff) < (_src & 0xff);
                break;
            case 1:
                qc = (Yc & 0xffff) < (_src & 0xffff);
                break;
            case 2:
                qc = (Yc >>> 0) < (_src >>> 0);
                break;
            case 3:
                qc = (Yc & 0xff) <= (_src & 0xff);
                break;
            case 4:
                qc = (Yc & 0xffff) <= (_src & 0xffff);
                break;
            case 5:
                qc = (Yc >>> 0) <= (_src >>> 0);
                break;
            case 6:
                qc = ((Yc + _src) & 0xff) < (_src & 0xff);
                break;
            case 7:
                qc = ((Yc + _src) & 0xffff) < (_src & 0xffff);
                break;
            case 8:
                qc = ((Yc + _src) >>> 0) < (_src >>> 0);
                break;
            case 9:
                Yb = (Yc + _src + 1) & 0xff;
                qc = Yb <= (_src & 0xff);
                break;
            case 10:
                Yb = (Yc + _src + 1) & 0xffff;
                qc = Yb <= (_src & 0xffff);
                break;
            case 11:
                Yb = (Yc + _src + 1) >>> 0;
                qc = Yb <= (_src >>> 0);
                break;
            case 12:
            case 13:
            case 14:
                qc = 0;
                break;
            case 15:
                qc = (_src >> 7) & 1;
                break;
            case 16:
                qc = (_src >> 15) & 1;
                break;
            case 17:
                qc = (_src >> 31) & 1;
                break;
            case 18:
            case 19:
            case 20:
                qc = _src & 1;
                break;
            case 21:
            case 22:
            case 23:
                qc = _src != 0;
                break;
            case 24:
                qc = _src & 1;
                break;
            default:
                throw "GET_CARRY: unsupported cc_op=" + _op;
        }
        return qc;
    }
    function Zc() {
        var qc, Yb;
        switch (_op) {
            case 0:
                Yb = (_dst - _src) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 7) & 1;
                break;
            case 1:
                Yb = (_dst - _src) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 15) & 1;
                break;
            case 2:
                Yb = (_dst - _src) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 31) & 1;
                break;
            case 3:
                Yb = (_dst - _src - 1) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 7) & 1;
                break;
            case 4:
                Yb = (_dst - _src - 1) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 15) & 1;
                break;
            case 5:
                Yb = (_dst - _src - 1) >> 0;
                qc = (((Yb ^ _src ^ -1) & (Yb ^ _dst)) >> 31) & 1;
                break;
            case 6:
                Yb = (_dst + _src) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 7) & 1;
                break;
            case 7:
                Yb = (_dst + _src) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 15) & 1;
                break;
            case 8:
                Yb = (_dst + _src) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 31) & 1;
                break;
            case 9:
                Yb = (_dst + _src + 1) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 7) & 1;
                break;
            case 10:
                Yb = (_dst + _src + 1) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 15) & 1;
                break;
            case 11:
                Yb = (_dst + _src + 1) >> 0;
                qc = (((Yb ^ _src) & (Yb ^ _dst)) >> 31) & 1;
                break;
            case 12:
            case 13:
            case 14:
                qc = 0;
                break;
            case 15:
            case 18:
                qc = ((_src ^ _dst) >> 7) & 1;
                break;
            case 16:
            case 19:
                qc = ((_src ^ _dst) >> 15) & 1;
                break;
            case 17:
            case 20:
                qc = ((_src ^ _dst) >> 31) & 1;
                break;
            case 21:
            case 22:
            case 23:
                qc = _src != 0;
                break;
            case 24:
                qc = (_src >> 11) & 1;
                break;
            case 25:
                qc = (_dst & 0xff) == 0x80;
                break;
            case 26:
                qc = (_dst & 0xffff) == 0x8000;
                break;
            case 27:
                qc = (_dst == -2147483648);
                break;
            case 28:
                qc = (_dst & 0xff) == 0x7f;
                break;
            case 29:
                qc = (_dst & 0xffff) == 0x7fff;
                break;
            case 30:
                qc = _dst == 0x7fffffff;
                break;
            default:
                throw "JO: unsupported cc_op=" + _op;
        }
        return qc;
    }
    function ad() {
        var qc;
        switch (_op) {
            case 6:
                qc = ((_dst + _src) & 0xff) <= (_src & 0xff);
                break;
            case 7:
                qc = ((_dst + _src) & 0xffff) <= (_src & 0xffff);
                break;
            case 8:
                qc = ((_dst + _src) >>> 0) <= (_src >>> 0);
                break;
            case 24:
                qc = (_src & (0x0040 | 0x0001)) != 0;
                break;
            default:
                qc = bc() | (_dst == 0);
                break;
        }
        return qc;
    }
    function bd() {
        if (_op == 24) {
            return (_src >> 2) & 1;
        } else {
            return aa[_dst & 0xff];
        }
    }
    function cd() {
        var qc;
        switch (_op) {
            case 6:
                qc = ((_dst + _src) << 24) < (_src << 24);
                break;
            case 7:
                qc = ((_dst + _src) << 16) < (_src << 16);
                break;
            case 8:
                qc = ((_dst + _src) >> 0) < _src;
                break;
            case 12:
            case 25:
            case 28:
            case 13:
            case 26:
            case 29:
            case 14:
            case 27:
            case 30:
                qc = _dst < 0;
                break;
            case 24:
                qc = ((_src >> 7) ^ (_src >> 11)) & 1;
                break;
            default:
                qc = (_op == 24 ? ((_src >> 7) & 1) : (_dst < 0)) ^ Zc();
                break;
        }
        return qc;
    }
    function dd() {
        var qc;
        switch (_op) {
            case 6:
                qc = ((_dst + _src) << 24) <= (_src << 24);
                break;
            case 7:
                qc = ((_dst + _src) << 16) <= (_src << 16);
                break;
            case 8:
                qc = ((_dst + _src) >> 0) <= _src;
                break;
            case 12:
            case 25:
            case 28:
            case 13:
            case 26:
            case 29:
            case 14:
            case 27:
            case 30:
                qc = _dst <= 0;
                break;
            case 24:
                qc = (((_src >> 7) ^ (_src >> 11)) | (_src >> 6)) & 1;
                break;
            default:
                qc = ((_op == 24 ? ((_src >> 7) & 1) : (_dst < 0)) ^ Zc()) | (_dst == 0);
                break;
        }
        return qc;
    }
    function ed() {
        var Yb, qc;
        switch (_op) {
            case 0:
            case 1:
            case 2:
                Yb = (_dst - _src) >> 0;
                qc = (_dst ^ Yb ^ _src) & 0x10;
                break;
            case 3:
            case 4:
            case 5:
                Yb = (_dst - _src - 1) >> 0;
                qc = (_dst ^ Yb ^ _src) & 0x10;
                break;
            case 6:
            case 7:
            case 8:
                Yb = (_dst + _src) >> 0;
                qc = (_dst ^ Yb ^ _src) & 0x10;
                break;
            case 9:
            case 10:
            case 11:
                Yb = (_dst + _src + 1) >> 0;
                qc = (_dst ^ Yb ^ _src) & 0x10;
                break;
            case 12:
            case 13:
            case 14:
                qc = 0;
                break;
            case 15:
            case 18:
            case 16:
            case 19:
            case 17:
            case 20:
            case 21:
            case 22:
            case 23:
                qc = 0;
                break;
            case 24:
                qc = _src & 0x10;
                break;
            case 25:
            case 26:
            case 27:
                qc = (_dst ^ (_dst - 1)) & 0x10;
                break;
            case 28:
            case 29:
            case 30:
                qc = (_dst ^ (_dst + 1)) & 0x10;
                break;
            default:
                throw "AF: unsupported cc_op=" + _op;
        }
        return qc;
    }
    function fd(gd) {
        var qc;
        switch (gd >> 1) {
            case 0:
                qc = Zc();
                break;
            case 1:
                qc = bc();
                break;
            case 2:
                qc = (_dst == 0);
                break;
            case 3:
                qc = ad();
                break;
            case 4:
                qc = (_op == 24 ? ((_src >> 7) & 1) : (_dst < 0));
                break;
            case 5:
                qc = bd();
                break;
            case 6:
                qc = cd();
                break;
            case 7:
                qc = dd();
                break;
            default:
                throw "unsupported cond: " + gd;
        }
        return qc ^ (gd & 1);
    }
    function lc() {
        return (bd() << 2) | ((_dst == 0) << 6) | ((_op == 24 ? ((_src >> 7) & 1) : (_dst < 0)) << 7) | ed();
    }
    function hd() {
        return (bc() << 0) | (bd() << 2) | ((_dst == 0) << 6) | ((_op == 24 ? ((_src >> 7) & 1) : (_dst < 0)) << 7) | (Zc() << 11) | ed();
    }
    function id() {
        var jd;
        jd = hd();
        jd |= cpu.df & 0x00000400;
        jd |= cpu.eflags;
        return jd;
    }
    function kd(jd, ld) {
        _src = jd & (0x0800 | 0x0080 | 0x0040 | 0x0010 | 0x0004 | 0x0001);
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
        cpu.df = 1 - (2 * ((jd >> 10) & 1));
        cpu.eflags = (cpu.eflags & ~ld) | (jd & ld);
    }
    function md() {
        return cpu.cycle_count + (ua - Ka);
    }
    function nd(na) {
        throw "CPU abort: " + na;
    }
    function od() {
        cpu.eip = Jb;
        cpu.cc_src = _src;
        cpu.cc_dst = _dst;
        cpu.cc_op = _op;
        cpu.cc_op2 = Ba;
        cpu.cc_dst2 = Ca;
        cpu.dump();
    }
    function pd() {
        cpu.eip = Jb;
        cpu.cc_src = _src;
        cpu.cc_dst = _dst;
        cpu.cc_op = _op;
        cpu.cc_op2 = Ba;
        cpu.cc_dst2 = Ca;
        cpu.dump_short();
    }
    function qd(intno, error_code) {
        cpu.cycle_count += (ua - Ka);
        cpu.eip = Jb;
        cpu.cc_src = _src;
        cpu.cc_dst = _dst;
        cpu.cc_op = _op;
        cpu.cc_op2 = Ba;
        cpu.cc_dst2 = Ca;
        throw {intno: intno,error_code: error_code};
    }
    function Dc(intno) {
        qd(intno, 0);
    }
    function rd(sd) {
        cpu.cpl = sd;
        if (cpu.cpl == 3) {
            bb = tlb_read_user;
            cb = tlb_write_user;
        } else {
            bb = tlb_read_kernel;
            cb = tlb_write_kernel;
        }
    }
    function td(fa, ud) {
        var eb;
        if (ud) {
            eb = cb[fa >>> 12];
        } else {
            eb = bb[fa >>> 12];
        }
        if (eb == -1) {
            fb(fa, ud, cpu.cpl == 3);
            if (ud) {
                eb = cb[fa >>> 12];
            } else {
                eb = bb[fa >>> 12];
            }
        }
        return eb ^ fa;
    }
    function vd(ga) {
        var wd;
        wd = regs[4] - 2;
        fa = ((wd & Pa) + Oa) >> 0;
        ub(ga);
        regs[4] = (regs[4] & ~Pa) | ((wd) & Pa);
    }
    function xd(ga) {
        var wd;
        wd = regs[4] - 4;
        fa = ((wd & Pa) + Oa) >> 0;
        wb(ga);
        regs[4] = (regs[4] & ~Pa) | ((wd) & Pa);
    }
    function yd() {
        fa = ((regs[4] & Pa) + Oa) >> 0;
        return ib();
    }
    function zd() {
        regs[4] = (regs[4] & ~Pa) | ((regs[4] + 2) & Pa);
    }
    function Ad() {
        fa = ((regs[4] & Pa) + Oa) >> 0;
        return kb();
    }
    function Bd() {
        regs[4] = (regs[4] & ~Pa) | ((regs[4] + 4) & Pa);
    }
    function Cd(Nb, b) {
        var n, Da, l, Ea, Dd, base, Ja, Ed;
        n = 1;
        Da = Ra;
        if (Da & 0x0100)
            Ed = 2;
        else
            Ed = 4;
        Fd: for (; ; ) {
            switch (b) {
                case 0x66:
                    if (Ra & 0x0100) {
                        Ed = 4;
                        Da &= ~0x0100;
                    } else {
                        Ed = 2;
                        Da |= 0x0100;
                    }
                case 0xf0:
                case 0xf2:
                case 0xf3:
                case 0x26:
                case 0x2e:
                case 0x36:
                case 0x3e:
                case 0x64:
                case 0x65:
                    {
                        if ((n + 1) > 15)
                            Dc(6);
                        fa = (Nb + (n++)) >> 0;
                        b = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                    }
                    ;
                    break;
                case 0x67:
                    if (Ra & 0x0080) {
                        Da &= ~0x0080;
                    } else {
                        Da |= 0x0080;
                    }
                    {
                        if ((n + 1) > 15)
                            Dc(6);
                        fa = (Nb + (n++)) >> 0;
                        b = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                    }
                    ;
                    break;
                case 0x91:
                case 0x92:
                case 0x93:
                case 0x94:
                case 0x95:
                case 0x96:
                case 0x97:
                case 0x40:
                case 0x41:
                case 0x42:
                case 0x43:
                case 0x44:
                case 0x45:
                case 0x46:
                case 0x47:
                case 0x48:
                case 0x49:
                case 0x4a:
                case 0x4b:
                case 0x4c:
                case 0x4d:
                case 0x4e:
                case 0x4f:
                case 0x50:
                case 0x51:
                case 0x52:
                case 0x53:
                case 0x54:
                case 0x55:
                case 0x56:
                case 0x57:
                case 0x58:
                case 0x59:
                case 0x5a:
                case 0x5b:
                case 0x5c:
                case 0x5d:
                case 0x5e:
                case 0x5f:
                case 0x98:
                case 0x99:
                case 0xc9:
                case 0x9c:
                case 0x9d:
                case 0x06:
                case 0x0e:
                case 0x16:
                case 0x1e:
                case 0x07:
                case 0x17:
                case 0x1f:
                case 0xc3:
                case 0xcb:
                case 0x90:
                case 0xcc:
                case 0xce:
                case 0xcf:
                case 0xf5:
                case 0xf8:
                case 0xf9:
                case 0xfc:
                case 0xfd:
                case 0xfa:
                case 0xfb:
                case 0x9e:
                case 0x9f:
                case 0xf4:
                case 0xa4:
                case 0xa5:
                case 0xaa:
                case 0xab:
                case 0xa6:
                case 0xa7:
                case 0xac:
                case 0xad:
                case 0xae:
                case 0xaf:
                case 0x9b:
                case 0xec:
                case 0xed:
                case 0xee:
                case 0xef:
                case 0xd7:
                case 0x27:
                case 0x2f:
                case 0x37:
                case 0x3f:
                case 0x60:
                case 0x61:
                case 0x6c:
                case 0x6d:
                case 0x6e:
                case 0x6f:
                    break Fd;
                case 0xb0:
                case 0xb1:
                case 0xb2:
                case 0xb3:
                case 0xb4:
                case 0xb5:
                case 0xb6:
                case 0xb7:
                case 0x04:
                case 0x0c:
                case 0x14:
                case 0x1c:
                case 0x24:
                case 0x2c:
                case 0x34:
                case 0x3c:
                case 0xa8:
                case 0x6a:
                case 0xeb:
                case 0x70:
                case 0x71:
                case 0x72:
                case 0x73:
                case 0x76:
                case 0x77:
                case 0x78:
                case 0x79:
                case 0x7a:
                case 0x7b:
                case 0x7c:
                case 0x7d:
                case 0x7e:
                case 0x7f:
                case 0x74:
                case 0x75:
                case 0xe0:
                case 0xe1:
                case 0xe2:
                case 0xe3:
                case 0xcd:
                case 0xe4:
                case 0xe5:
                case 0xe6:
                case 0xe7:
                case 0xd4:
                case 0xd5:
                    n++;
                    if (n > 15)
                        Dc(6);
                    break Fd;
                case 0xb8:
                case 0xb9:
                case 0xba:
                case 0xbb:
                case 0xbc:
                case 0xbd:
                case 0xbe:
                case 0xbf:
                case 0x05:
                case 0x0d:
                case 0x15:
                case 0x1d:
                case 0x25:
                case 0x2d:
                case 0x35:
                case 0x3d:
                case 0xa9:
                case 0x68:
                case 0xe9:
                case 0xe8:
                    n += Ed;
                    if (n > 15)
                        Dc(6);
                    break Fd;
                case 0x88:
                case 0x89:
                case 0x8a:
                case 0x8b:
                case 0x86:
                case 0x87:
                case 0x8e:
                case 0x8c:
                case 0xc4:
                case 0xc5:
                case 0x00:
                case 0x08:
                case 0x10:
                case 0x18:
                case 0x20:
                case 0x28:
                case 0x30:
                case 0x38:
                case 0x01:
                case 0x09:
                case 0x11:
                case 0x19:
                case 0x21:
                case 0x29:
                case 0x31:
                case 0x39:
                case 0x02:
                case 0x0a:
                case 0x12:
                case 0x1a:
                case 0x22:
                case 0x2a:
                case 0x32:
                case 0x3a:
                case 0x03:
                case 0x0b:
                case 0x13:
                case 0x1b:
                case 0x23:
                case 0x2b:
                case 0x33:
                case 0x3b:
                case 0x84:
                case 0x85:
                case 0xd0:
                case 0xd1:
                case 0xd2:
                case 0xd3:
                case 0x8f:
                case 0x8d:
                case 0xfe:
                case 0xff:
                case 0xd8:
                case 0xd9:
                case 0xda:
                case 0xdb:
                case 0xdc:
                case 0xdd:
                case 0xde:
                case 0xdf:
                case 0x62:
                case 0x63:
                    {
                        {
                            if ((n + 1) > 15)
                                Dc(6);
                            fa = (Nb + (n++)) >> 0;
                            Ea = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                        }
                        ;
                        if (Da & 0x0080) {
                            switch (Ea >> 6) {
                                case 0:
                                    if ((Ea & 7) == 6)
                                        n += 2;
                                    break;
                                case 1:
                                    n++;
                                    break;
                                default:
                                    n += 2;
                                    break;
                            }
                        } else {
                            switch ((Ea & 7) | ((Ea >> 3) & 0x18)) {
                                case 0x04:
                                    {
                                        if ((n + 1) > 15)
                                            Dc(6);
                                        fa = (Nb + (n++)) >> 0;
                                        Dd = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                                    }
                                    ;
                                    if ((Dd & 7) == 5) {
                                        n += 4;
                                    }
                                    break;
                                case 0x0c:
                                    n += 2;
                                    break;
                                case 0x14:
                                    n += 5;
                                    break;
                                case 0x05:
                                    n += 4;
                                    break;
                                case 0x00:
                                case 0x01:
                                case 0x02:
                                case 0x03:
                                case 0x06:
                                case 0x07:
                                    break;
                                case 0x08:
                                case 0x09:
                                case 0x0a:
                                case 0x0b:
                                case 0x0d:
                                case 0x0e:
                                case 0x0f:
                                    n++;
                                    break;
                                case 0x10:
                                case 0x11:
                                case 0x12:
                                case 0x13:
                                case 0x15:
                                case 0x16:
                                case 0x17:
                                    n += 4;
                                    break;
                            }
                        }
                        if (n > 15)
                            Dc(6);
                    }
                    ;
                    break Fd;
                case 0xa0:
                case 0xa1:
                case 0xa2:
                case 0xa3:
                    if (Da & 0x0100)
                        n += 2;
                    else
                        n += 4;
                    if (n > 15)
                        Dc(6);
                    break Fd;
                case 0xc6:
                case 0x80:
                case 0x82:
                case 0x83:
                case 0x6b:
                case 0xc0:
                case 0xc1:
                    {
                        {
                            if ((n + 1) > 15)
                                Dc(6);
                            fa = (Nb + (n++)) >> 0;
                            Ea = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                        }
                        ;
                        if (Da & 0x0080) {
                            switch (Ea >> 6) {
                                case 0:
                                    if ((Ea & 7) == 6)
                                        n += 2;
                                    break;
                                case 1:
                                    n++;
                                    break;
                                default:
                                    n += 2;
                                    break;
                            }
                        } else {
                            switch ((Ea & 7) | ((Ea >> 3) & 0x18)) {
                                case 0x04:
                                    {
                                        if ((n + 1) > 15)
                                            Dc(6);
                                        fa = (Nb + (n++)) >> 0;
                                        Dd = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                                    }
                                    ;
                                    if ((Dd & 7) == 5) {
                                        n += 4;
                                    }
                                    break;
                                case 0x0c:
                                    n += 2;
                                    break;
                                case 0x14:
                                    n += 5;
                                    break;
                                case 0x05:
                                    n += 4;
                                    break;
                                case 0x00:
                                case 0x01:
                                case 0x02:
                                case 0x03:
                                case 0x06:
                                case 0x07:
                                    break;
                                case 0x08:
                                case 0x09:
                                case 0x0a:
                                case 0x0b:
                                case 0x0d:
                                case 0x0e:
                                case 0x0f:
                                    n++;
                                    break;
                                case 0x10:
                                case 0x11:
                                case 0x12:
                                case 0x13:
                                case 0x15:
                                case 0x16:
                                case 0x17:
                                    n += 4;
                                    break;
                            }
                        }
                        if (n > 15)
                            Dc(6);
                    }
                    ;
                    n++;
                    if (n > 15)
                        Dc(6);
                    break Fd;
                case 0xc7:
                case 0x81:
                case 0x69:
                    {
                        {
                            if ((n + 1) > 15)
                                Dc(6);
                            fa = (Nb + (n++)) >> 0;
                            Ea = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                        }
                        ;
                        if (Da & 0x0080) {
                            switch (Ea >> 6) {
                                case 0:
                                    if ((Ea & 7) == 6)
                                        n += 2;
                                    break;
                                case 1:
                                    n++;
                                    break;
                                default:
                                    n += 2;
                                    break;
                            }
                        } else {
                            switch ((Ea & 7) | ((Ea >> 3) & 0x18)) {
                                case 0x04:
                                    {
                                        if ((n + 1) > 15)
                                            Dc(6);
                                        fa = (Nb + (n++)) >> 0;
                                        Dd = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                                    }
                                    ;
                                    if ((Dd & 7) == 5) {
                                        n += 4;
                                    }
                                    break;
                                case 0x0c:
                                    n += 2;
                                    break;
                                case 0x14:
                                    n += 5;
                                    break;
                                case 0x05:
                                    n += 4;
                                    break;
                                case 0x00:
                                case 0x01:
                                case 0x02:
                                case 0x03:
                                case 0x06:
                                case 0x07:
                                    break;
                                case 0x08:
                                case 0x09:
                                case 0x0a:
                                case 0x0b:
                                case 0x0d:
                                case 0x0e:
                                case 0x0f:
                                    n++;
                                    break;
                                case 0x10:
                                case 0x11:
                                case 0x12:
                                case 0x13:
                                case 0x15:
                                case 0x16:
                                case 0x17:
                                    n += 4;
                                    break;
                            }
                        }
                        if (n > 15)
                            Dc(6);
                    }
                    ;
                    n += Ed;
                    if (n > 15)
                        Dc(6);
                    break Fd;
                case 0xf6:
                    {
                        {
                            if ((n + 1) > 15)
                                Dc(6);
                            fa = (Nb + (n++)) >> 0;
                            Ea = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                        }
                        ;
                        if (Da & 0x0080) {
                            switch (Ea >> 6) {
                                case 0:
                                    if ((Ea & 7) == 6)
                                        n += 2;
                                    break;
                                case 1:
                                    n++;
                                    break;
                                default:
                                    n += 2;
                                    break;
                            }
                        } else {
                            switch ((Ea & 7) | ((Ea >> 3) & 0x18)) {
                                case 0x04:
                                    {
                                        if ((n + 1) > 15)
                                            Dc(6);
                                        fa = (Nb + (n++)) >> 0;
                                        Dd = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                                    }
                                    ;
                                    if ((Dd & 7) == 5) {
                                        n += 4;
                                    }
                                    break;
                                case 0x0c:
                                    n += 2;
                                    break;
                                case 0x14:
                                    n += 5;
                                    break;
                                case 0x05:
                                    n += 4;
                                    break;
                                case 0x00:
                                case 0x01:
                                case 0x02:
                                case 0x03:
                                case 0x06:
                                case 0x07:
                                    break;
                                case 0x08:
                                case 0x09:
                                case 0x0a:
                                case 0x0b:
                                case 0x0d:
                                case 0x0e:
                                case 0x0f:
                                    n++;
                                    break;
                                case 0x10:
                                case 0x11:
                                case 0x12:
                                case 0x13:
                                case 0x15:
                                case 0x16:
                                case 0x17:
                                    n += 4;
                                    break;
                            }
                        }
                        if (n > 15)
                            Dc(6);
                    }
                    ;
                    Ja = (Ea >> 3) & 7;
                    if (Ja == 0) {
                        n++;
                        if (n > 15)
                            Dc(6);
                    }
                    break Fd;
                case 0xf7:
                    {
                        {
                            if ((n + 1) > 15)
                                Dc(6);
                            fa = (Nb + (n++)) >> 0;
                            Ea = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                        }
                        ;
                        if (Da & 0x0080) {
                            switch (Ea >> 6) {
                                case 0:
                                    if ((Ea & 7) == 6)
                                        n += 2;
                                    break;
                                case 1:
                                    n++;
                                    break;
                                default:
                                    n += 2;
                                    break;
                            }
                        } else {
                            switch ((Ea & 7) | ((Ea >> 3) & 0x18)) {
                                case 0x04:
                                    {
                                        if ((n + 1) > 15)
                                            Dc(6);
                                        fa = (Nb + (n++)) >> 0;
                                        Dd = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                                    }
                                    ;
                                    if ((Dd & 7) == 5) {
                                        n += 4;
                                    }
                                    break;
                                case 0x0c:
                                    n += 2;
                                    break;
                                case 0x14:
                                    n += 5;
                                    break;
                                case 0x05:
                                    n += 4;
                                    break;
                                case 0x00:
                                case 0x01:
                                case 0x02:
                                case 0x03:
                                case 0x06:
                                case 0x07:
                                    break;
                                case 0x08:
                                case 0x09:
                                case 0x0a:
                                case 0x0b:
                                case 0x0d:
                                case 0x0e:
                                case 0x0f:
                                    n++;
                                    break;
                                case 0x10:
                                case 0x11:
                                case 0x12:
                                case 0x13:
                                case 0x15:
                                case 0x16:
                                case 0x17:
                                    n += 4;
                                    break;
                            }
                        }
                        if (n > 15)
                            Dc(6);
                    }
                    ;
                    Ja = (Ea >> 3) & 7;
                    if (Ja == 0) {
                        n += Ed;
                        if (n > 15)
                            Dc(6);
                    }
                    break Fd;
                case 0xea:
                case 0x9a:
                    n += 2 + Ed;
                    if (n > 15)
                        Dc(6);
                    break Fd;
                case 0xc2:
                case 0xca:
                    n += 2;
                    if (n > 15)
                        Dc(6);
                    break Fd;
                case 0xc8:
                    n += 3;
                    if (n > 15)
                        Dc(6);
                    break Fd;
                case 0xd6:
                case 0xf1:
                default:
                    Dc(6);
                case 0x0f:
                    {
                        if ((n + 1) > 15)
                            Dc(6);
                        fa = (Nb + (n++)) >> 0;
                        b = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                    }
                    ;
                    switch (b) {
                        case 0x06:
                        case 0xa2:
                        case 0x31:
                        case 0xa0:
                        case 0xa8:
                        case 0xa1:
                        case 0xa9:
                        case 0xc8:
                        case 0xc9:
                        case 0xca:
                        case 0xcb:
                        case 0xcc:
                        case 0xcd:
                        case 0xce:
                        case 0xcf:
                            break Fd;
                        case 0x80:
                        case 0x81:
                        case 0x82:
                        case 0x83:
                        case 0x84:
                        case 0x85:
                        case 0x86:
                        case 0x87:
                        case 0x88:
                        case 0x89:
                        case 0x8a:
                        case 0x8b:
                        case 0x8c:
                        case 0x8d:
                        case 0x8e:
                        case 0x8f:
                            n += Ed;
                            if (n > 15)
                                Dc(6);
                            break Fd;
                        case 0x90:
                        case 0x91:
                        case 0x92:
                        case 0x93:
                        case 0x94:
                        case 0x95:
                        case 0x96:
                        case 0x97:
                        case 0x98:
                        case 0x99:
                        case 0x9a:
                        case 0x9b:
                        case 0x9c:
                        case 0x9d:
                        case 0x9e:
                        case 0x9f:
                        case 0x40:
                        case 0x41:
                        case 0x42:
                        case 0x43:
                        case 0x44:
                        case 0x45:
                        case 0x46:
                        case 0x47:
                        case 0x48:
                        case 0x49:
                        case 0x4a:
                        case 0x4b:
                        case 0x4c:
                        case 0x4d:
                        case 0x4e:
                        case 0x4f:
                        case 0xb6:
                        case 0xb7:
                        case 0xbe:
                        case 0xbf:
                        case 0x00:
                        case 0x01:
                        case 0x02:
                        case 0x03:
                        case 0x20:
                        case 0x22:
                        case 0x23:
                        case 0xb2:
                        case 0xb4:
                        case 0xb5:
                        case 0xa5:
                        case 0xad:
                        case 0xa3:
                        case 0xab:
                        case 0xb3:
                        case 0xbb:
                        case 0xbc:
                        case 0xbd:
                        case 0xaf:
                        case 0xc0:
                        case 0xc1:
                        case 0xb0:
                        case 0xb1:
                            {
                                {
                                    if ((n + 1) > 15)
                                        Dc(6);
                                    fa = (Nb + (n++)) >> 0;
                                    Ea = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                                }
                                ;
                                if (Da & 0x0080) {
                                    switch (Ea >> 6) {
                                        case 0:
                                            if ((Ea & 7) == 6)
                                                n += 2;
                                            break;
                                        case 1:
                                            n++;
                                            break;
                                        default:
                                            n += 2;
                                            break;
                                    }
                                } else {
                                    switch ((Ea & 7) | ((Ea >> 3) & 0x18)) {
                                        case 0x04:
                                            {
                                                if ((n + 1) > 15)
                                                    Dc(6);
                                                fa = (Nb + (n++)) >> 0;
                                                Dd = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                                            }
                                            ;
                                            if ((Dd & 7) == 5) {
                                                n += 4;
                                            }
                                            break;
                                        case 0x0c:
                                            n += 2;
                                            break;
                                        case 0x14:
                                            n += 5;
                                            break;
                                        case 0x05:
                                            n += 4;
                                            break;
                                        case 0x00:
                                        case 0x01:
                                        case 0x02:
                                        case 0x03:
                                        case 0x06:
                                        case 0x07:
                                            break;
                                        case 0x08:
                                        case 0x09:
                                        case 0x0a:
                                        case 0x0b:
                                        case 0x0d:
                                        case 0x0e:
                                        case 0x0f:
                                            n++;
                                            break;
                                        case 0x10:
                                        case 0x11:
                                        case 0x12:
                                        case 0x13:
                                        case 0x15:
                                        case 0x16:
                                        case 0x17:
                                            n += 4;
                                            break;
                                    }
                                }
                                if (n > 15)
                                    Dc(6);
                            }
                            ;
                            break Fd;
                        case 0xa4:
                        case 0xac:
                        case 0xba:
                            {
                                {
                                    if ((n + 1) > 15)
                                        Dc(6);
                                    fa = (Nb + (n++)) >> 0;
                                    Ea = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                                }
                                ;
                                if (Da & 0x0080) {
                                    switch (Ea >> 6) {
                                        case 0:
                                            if ((Ea & 7) == 6)
                                                n += 2;
                                            break;
                                        case 1:
                                            n++;
                                            break;
                                        default:
                                            n += 2;
                                            break;
                                    }
                                } else {
                                    switch ((Ea & 7) | ((Ea >> 3) & 0x18)) {
                                        case 0x04:
                                            {
                                                if ((n + 1) > 15)
                                                    Dc(6);
                                                fa = (Nb + (n++)) >> 0;
                                                Dd = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                                            }
                                            ;
                                            if ((Dd & 7) == 5) {
                                                n += 4;
                                            }
                                            break;
                                        case 0x0c:
                                            n += 2;
                                            break;
                                        case 0x14:
                                            n += 5;
                                            break;
                                        case 0x05:
                                            n += 4;
                                            break;
                                        case 0x00:
                                        case 0x01:
                                        case 0x02:
                                        case 0x03:
                                        case 0x06:
                                        case 0x07:
                                            break;
                                        case 0x08:
                                        case 0x09:
                                        case 0x0a:
                                        case 0x0b:
                                        case 0x0d:
                                        case 0x0e:
                                        case 0x0f:
                                            n++;
                                            break;
                                        case 0x10:
                                        case 0x11:
                                        case 0x12:
                                        case 0x13:
                                        case 0x15:
                                        case 0x16:
                                        case 0x17:
                                            n += 4;
                                            break;
                                    }
                                }
                                if (n > 15)
                                    Dc(6);
                            }
                            ;
                            n++;
                            if (n > 15)
                                Dc(6);
                            break Fd;
                        case 0x04:
                        case 0x05:
                        case 0x07:
                        case 0x08:
                        case 0x09:
                        case 0x0a:
                        case 0x0b:
                        case 0x0c:
                        case 0x0d:
                        case 0x0e:
                        case 0x0f:
                        case 0x10:
                        case 0x11:
                        case 0x12:
                        case 0x13:
                        case 0x14:
                        case 0x15:
                        case 0x16:
                        case 0x17:
                        case 0x18:
                        case 0x19:
                        case 0x1a:
                        case 0x1b:
                        case 0x1c:
                        case 0x1d:
                        case 0x1e:
                        case 0x1f:
                        case 0x21:
                        case 0x24:
                        case 0x25:
                        case 0x26:
                        case 0x27:
                        case 0x28:
                        case 0x29:
                        case 0x2a:
                        case 0x2b:
                        case 0x2c:
                        case 0x2d:
                        case 0x2e:
                        case 0x2f:
                        case 0x30:
                        case 0x32:
                        case 0x33:
                        case 0x34:
                        case 0x35:
                        case 0x36:
                        case 0x37:
                        case 0x38:
                        case 0x39:
                        case 0x3a:
                        case 0x3b:
                        case 0x3c:
                        case 0x3d:
                        case 0x3e:
                        case 0x3f:
                        case 0x50:
                        case 0x51:
                        case 0x52:
                        case 0x53:
                        case 0x54:
                        case 0x55:
                        case 0x56:
                        case 0x57:
                        case 0x58:
                        case 0x59:
                        case 0x5a:
                        case 0x5b:
                        case 0x5c:
                        case 0x5d:
                        case 0x5e:
                        case 0x5f:
                        case 0x60:
                        case 0x61:
                        case 0x62:
                        case 0x63:
                        case 0x64:
                        case 0x65:
                        case 0x66:
                        case 0x67:
                        case 0x68:
                        case 0x69:
                        case 0x6a:
                        case 0x6b:
                        case 0x6c:
                        case 0x6d:
                        case 0x6e:
                        case 0x6f:
                        case 0x70:
                        case 0x71:
                        case 0x72:
                        case 0x73:
                        case 0x74:
                        case 0x75:
                        case 0x76:
                        case 0x77:
                        case 0x78:
                        case 0x79:
                        case 0x7a:
                        case 0x7b:
                        case 0x7c:
                        case 0x7d:
                        case 0x7e:
                        case 0x7f:
                        case 0xa6:
                        case 0xa7:
                        case 0xaa:
                        case 0xae:
                        case 0xb8:
                        case 0xb9:
                        case 0xc2:
                        case 0xc3:
                        case 0xc4:
                        case 0xc5:
                        case 0xc6:
                        case 0xc7:
                        default:
                            Dc(6);
                    }
                    break;
            }
        }
        return n;
    }
    function fb(Gd, Hd, ja) {
        var Id, Jd, error_code, Kd, Ld, Md, Nd, ud, Od;
        if (!(cpu.cr0 & (1 << 31))) {
            cpu.tlb_set_page(Gd & -4096, Gd & -4096, 1);
        } else {
            Id = (cpu.cr3 & -4096) + ((Gd >> 20) & 0xffc);
            Jd = cpu.ld32_phys(Id);
            if (!(Jd & 0x00000001)) {
                error_code = 0;
            } else {
                if (!(Jd & 0x00000020)) {
                    Jd |= 0x00000020;
                    cpu.st32_phys(Id, Jd);
                }
                Kd = (Jd & -4096) + ((Gd >> 10) & 0xffc);
                Ld = cpu.ld32_phys(Kd);
                if (!(Ld & 0x00000001)) {
                    error_code = 0;
                } else {
                    Md = Ld & Jd;
                    if (ja && !(Md & 0x00000004)) {
                        error_code = 0x01;
                    } else if (Hd && !(Md & 0x00000002)) {
                        error_code = 0x01;
                    } else {
                        Nd = (Hd && !(Ld & 0x00000040));
                        if (!(Ld & 0x00000020) || Nd) {
                            Ld |= 0x00000020;
                            if (Nd)
                                Ld |= 0x00000040;
                            cpu.st32_phys(Kd, Ld);
                        }
                        ud = 0;
                        if ((Ld & 0x00000040) && (Md & 0x00000002))
                            ud = 1;
                        Od = 0;
                        if (Md & 0x00000004)
                            Od = 1;
                        cpu.tlb_set_page(Gd & -4096, Ld & -4096, ud, Od);
                        return;
                    }
                }
            }
            error_code |= Hd << 1;
            if (ja)
                error_code |= 0x04;
            cpu.cr2 = Gd;
            qd(14, error_code);
        }
    }
    function Pd(Qd) {
        if (!(Qd & (1 << 0)))
            nd("real mode not supported");
        if ((Qd & ((1 << 31) | (1 << 16) | (1 << 0))) != (cpu.cr0 & ((1 << 31) | (1 << 16) | (1 << 0)))) {
            cpu.tlb_flush_all();
        }
        cpu.cr0 = Qd | (1 << 4);
    }
    function Rd(Sd) {
        cpu.cr3 = Sd;
        if (cpu.cr0 & (1 << 31)) {
            cpu.tlb_flush_all();
        }
    }
    function Td(Ud) {
        cpu.cr4 = Ud;
    }
    function Vd(Wd) {
        if (Wd & (1 << 22))
            return -1;
        else
            return 0xffff;
    }
    function Xd(selector) {
        var sa, Rb, Yd, Wd;
        if (selector & 0x4)
            sa = cpu.ldt;
        else
            sa = cpu.gdt;
        Rb = selector & ~7;
        if ((Rb + 7) > sa.limit)
            return null;
        fa = sa.base + Rb;
        Yd = Cb();
        fa += 4;
        Wd = Cb();
        return [Yd, Wd];
    }
    function Zd(Yd, Wd) {
        var limit;
        limit = (Yd & 0xffff) | (Wd & 0x000f0000);
        if (Wd & (1 << 23))
            limit = (limit << 12) | 0xfff;
        return limit;
    }
    function ae(Yd, Wd) {
        return (((Yd >>> 16) | ((Wd & 0xff) << 16) | (Wd & 0xff000000))) & -1;
    }
    function be(sa, Yd, Wd) {
        sa.base = ae(Yd, Wd);
        sa.limit = Zd(Yd, Wd);
        sa.flags = Wd;
    }
    function ce() {
        Na = cpu.segs[1].base;
        Oa = cpu.segs[2].base;
        if (cpu.segs[2].flags & (1 << 22))
            Pa = -1;
        else
            Pa = 0xffff;
        Qa = (((Na | Oa | cpu.segs[3].base | cpu.segs[0].base) == 0) && Pa == -1);
        if (cpu.segs[1].flags & (1 << 22))
            Ra = 0;
        else
            Ra = 0x0100 | 0x0080;
    }
    function de(ee, selector, base, limit, flags) {
        cpu.segs[ee] = {selector: selector,base: base,limit: limit,flags: flags};
        ce();
    }
    function fe(Sb, selector) {
        de(Sb, selector, (selector << 4), 0xffff, (1 << 15) | (3 << 13) | (1 << 12) | (1 << 8) | (1 << 12) | (1 << 9));
    }
    function ge(he) {
        var ie, Rb, je, ke, le;
        if (!(cpu.tr.flags & (1 << 15)))
            nd("invalid tss");
        ie = (cpu.tr.flags >> 8) & 0xf;
        if ((ie & 7) != 1)
            nd("invalid tss type");
        je = ie >> 3;
        Rb = (he * 4 + 2) << je;
        if (Rb + (4 << je) - 1 > cpu.tr.limit)
            qd(10, cpu.tr.selector & 0xfffc);
        fa = (cpu.tr.base + Rb) & -1;
        if (je == 0) {
            le = Ab();
            fa += 2;
        } else {
            le = Cb();
            fa += 4;
        }
        ke = Ab();
        return [ke, le];
    }
    function me(intno, ne, error_code, oe, pe) {
        var sa, qe, ie, he, selector, re, se;
        var te, ue, je;
        var e, Yd, Wd, ve, ke, le, we, xe;
        var ye, Pa;
        te = 0;
        if (!ne && !pe) {
            switch (intno) {
                case 8:
                case 10:
                case 11:
                case 12:
                case 13:
                case 14:
                case 17:
                    te = 1;
                    break;
            }
        }
        if (ne)
            ye = oe;
        else
            ye = Jb;
        sa = cpu.idt;
        if (intno * 8 + 7 > sa.limit)
            qd(13, intno * 8 + 2);
        fa = (sa.base + intno * 8) & -1;
        Yd = Cb();
        fa += 4;
        Wd = Cb();
        ie = (Wd >> 8) & 0x1f;
        switch (ie) {
            case 5:
            case 7:
            case 6:
                throw "unsupported task gate";
            case 14:
            case 15:
                break;
            default:
                qd(13, intno * 8 + 2);
                break;
        }
        he = (Wd >> 13) & 3;
        se = cpu.cpl;
        if (ne && he < se)
            qd(13, intno * 8 + 2);
        if (!(Wd & (1 << 15)))
            qd(11, intno * 8 + 2);
        selector = Yd >> 16;
        ve = (Wd & -65536) | (Yd & 0x0000ffff);
        if ((selector & 0xfffc) == 0)
            qd(13, 0);
        e = Xd(selector);
        if (!e)
            qd(13, selector & 0xfffc);
        Yd = e[0];
        Wd = e[1];
        if (!(Wd & (1 << 12)) || !(Wd & ((1 << 11))))
            qd(13, selector & 0xfffc);
        he = (Wd >> 13) & 3;
        if (he > se)
            qd(13, selector & 0xfffc);
        if (!(Wd & (1 << 15)))
            qd(11, selector & 0xfffc);
        if (!(Wd & (1 << 10)) && he < se) {
            e = ge(he);
            ke = e[0];
            le = e[1];
            if ((ke & 0xfffc) == 0)
                qd(10, ke & 0xfffc);
            if ((ke & 3) != he)
                qd(10, ke & 0xfffc);
            e = Xd(ke);
            if (!e)
                qd(10, ke & 0xfffc);
            we = e[0];
            xe = e[1];
            re = (xe >> 13) & 3;
            if (re != he)
                qd(10, ke & 0xfffc);
            if (!(xe & (1 << 12)) || (xe & (1 << 11)) || !(xe & (1 << 9)))
                qd(10, ke & 0xfffc);
            if (!(xe & (1 << 15)))
                qd(10, ke & 0xfffc);
            ue = 1;
            Pa = Vd(xe);
            qe = ae(we, xe);
        } else if ((Wd & (1 << 10)) || he == se) {
            if (cpu.eflags & 0x00020000)
                qd(13, selector & 0xfffc);
            ue = 0;
            Pa = Vd(cpu.segs[2].flags);
            qe = cpu.segs[2].base;
            le = regs[4];
            he = se;
        } else {
            qd(13, selector & 0xfffc);
            ue = 0;
            Pa = 0;
            qe = 0;
            le = 0;
        }
        je = ie >> 3;
        if (je == 1) {
            if (ue) {
                if (cpu.eflags & 0x00020000) {
                    {
                        le = (le - 4) & -1;
                        fa = (qe + (le & Pa)) & -1;
                        Ib(cpu.segs[5].selector);
                    }
                    ;
                    {
                        le = (le - 4) & -1;
                        fa = (qe + (le & Pa)) & -1;
                        Ib(cpu.segs[4].selector);
                    }
                    ;
                    {
                        le = (le - 4) & -1;
                        fa = (qe + (le & Pa)) & -1;
                        Ib(cpu.segs[3].selector);
                    }
                    ;
                    {
                        le = (le - 4) & -1;
                        fa = (qe + (le & Pa)) & -1;
                        Ib(cpu.segs[0].selector);
                    }
                    ;
                }
                {
                    le = (le - 4) & -1;
                    fa = (qe + (le & Pa)) & -1;
                    Ib(cpu.segs[2].selector);
                }
                ;
                {
                    le = (le - 4) & -1;
                    fa = (qe + (le & Pa)) & -1;
                    Ib(regs[4]);
                }
                ;
            }
            {
                le = (le - 4) & -1;
                fa = (qe + (le & Pa)) & -1;
                Ib(id());
            }
            ;
            {
                le = (le - 4) & -1;
                fa = (qe + (le & Pa)) & -1;
                Ib(cpu.segs[1].selector);
            }
            ;
            {
                le = (le - 4) & -1;
                fa = (qe + (le & Pa)) & -1;
                Ib(ye);
            }
            ;
            if (te) {
                {
                    le = (le - 4) & -1;
                    fa = (qe + (le & Pa)) & -1;
                    Ib(error_code);
                }
                ;
            }
        } else {
            if (ue) {
                if (cpu.eflags & 0x00020000) {
                    {
                        le = (le - 2) & -1;
                        fa = (qe + (le & Pa)) & -1;
                        Gb(cpu.segs[5].selector);
                    }
                    ;
                    {
                        le = (le - 2) & -1;
                        fa = (qe + (le & Pa)) & -1;
                        Gb(cpu.segs[4].selector);
                    }
                    ;
                    {
                        le = (le - 2) & -1;
                        fa = (qe + (le & Pa)) & -1;
                        Gb(cpu.segs[3].selector);
                    }
                    ;
                    {
                        le = (le - 2) & -1;
                        fa = (qe + (le & Pa)) & -1;
                        Gb(cpu.segs[0].selector);
                    }
                    ;
                }
                {
                    le = (le - 2) & -1;
                    fa = (qe + (le & Pa)) & -1;
                    Gb(cpu.segs[2].selector);
                }
                ;
                {
                    le = (le - 2) & -1;
                    fa = (qe + (le & Pa)) & -1;
                    Gb(regs[4]);
                }
                ;
            }
            {
                le = (le - 2) & -1;
                fa = (qe + (le & Pa)) & -1;
                Gb(id());
            }
            ;
            {
                le = (le - 2) & -1;
                fa = (qe + (le & Pa)) & -1;
                Gb(cpu.segs[1].selector);
            }
            ;
            {
                le = (le - 2) & -1;
                fa = (qe + (le & Pa)) & -1;
                Gb(ye);
            }
            ;
            if (te) {
                {
                    le = (le - 2) & -1;
                    fa = (qe + (le & Pa)) & -1;
                    Gb(error_code);
                }
                ;
            }
        }
        if (ue) {
            if (cpu.eflags & 0x00020000) {
                de(0, 0, 0, 0, 0);
                de(3, 0, 0, 0, 0);
                de(4, 0, 0, 0, 0);
                de(5, 0, 0, 0, 0);
            }
            ke = (ke & ~3) | he;
            de(2, ke, qe, Zd(we, xe), xe);
        }
        regs[4] = (regs[4] & ~Pa) | ((le) & Pa);
        selector = (selector & ~3) | he;
        de(1, selector, ae(Yd, Wd), Zd(Yd, Wd), Wd);
        rd(he);
        Jb = ve, Kb = Mb = 0;
        if ((ie & 1) == 0) {
            cpu.eflags &= ~0x00000200;
        }
        cpu.eflags &= ~(0x00000100 | 0x00020000 | 0x00010000 | 0x00004000);
    }
    function ze(intno, ne, error_code, oe, pe) {
        var sa, qe, selector, ve, le, ye;
        sa = cpu.idt;
        if (intno * 4 + 3 > sa.limit)
            qd(13, intno * 8 + 2);
        fa = (sa.base + (intno << 2)) >> 0;
        ve = Ab();
        fa = (fa + 2) >> 0;
        selector = Ab();
        le = regs[4];
        if (ne)
            ye = oe;
        else
            ye = Jb;
        {
            le = (le - 2) >> 0;
            fa = ((le & Pa) + Oa) >> 0;
            ub(id());
        }
        ;
        {
            le = (le - 2) >> 0;
            fa = ((le & Pa) + Oa) >> 0;
            ub(cpu.segs[1].selector);
        }
        ;
        {
            le = (le - 2) >> 0;
            fa = ((le & Pa) + Oa) >> 0;
            ub(ye);
        }
        ;
        regs[4] = (regs[4] & ~Pa) | ((le) & Pa);
        Jb = ve, Kb = Mb = 0;
        cpu.segs[1].selector = selector;
        cpu.segs[1].base = (selector << 4);
        cpu.eflags &= ~(0x00000200 | 0x00000100 | 0x00040000 | 0x00010000);
    }
    function Ae(intno, ne, error_code, oe, pe) {
        if (intno == 0x06) {
            var Be = Jb;
            var Nb;
            na = "do_interrupt: intno=" + _2_bytes_(intno) + " error_code=" + _4_bytes_(error_code) + " EIP=" + _4_bytes_(Be) + " ESP=" + _4_bytes_(regs[4]) + " EAX=" + _4_bytes_(regs[0]) + " EBX=" + _4_bytes_(regs[3]) + " ECX=" + _4_bytes_(regs[1]);
            if (intno == 0x0e) {
                na += " CR2=" + _4_bytes_(cpu.cr2);
            }
            console.log(na);
            if (intno == 0x06) {
                var na, i, n;
                na = "Code:";
                Nb = (Be + Na) >> 0;
                n = 4096 - (Nb & 0xfff);
                if (n > 15)
                    n = 15;
                for (i = 0; i < n; i++) {
                    fa = (Nb + i) & -1;
                    na += " " + _2_bytes_(gb());
                }
                console.log(na);
            }
        }
        if (cpu.cr0 & (1 << 0)) {
            me(intno, ne, error_code, oe, pe);
        } else {
            ze(intno, ne, error_code, oe, pe);
        }
    }
    function Ce(selector) {
        var sa, Yd, Wd, Rb, De;
        selector &= 0xffff;
        if ((selector & 0xfffc) == 0) {
            cpu.ldt.base = 0;
            cpu.ldt.limit = 0;
        } else {
            if (selector & 0x4)
                qd(13, selector & 0xfffc);
            sa = cpu.gdt;
            Rb = selector & ~7;
            De = 7;
            if ((Rb + De) > sa.limit)
                qd(13, selector & 0xfffc);
            fa = (sa.base + Rb) & -1;
            Yd = Cb();
            fa += 4;
            Wd = Cb();
            if ((Wd & (1 << 12)) || ((Wd >> 8) & 0xf) != 2)
                qd(13, selector & 0xfffc);
            if (!(Wd & (1 << 15)))
                qd(11, selector & 0xfffc);
            be(cpu.ldt, Yd, Wd);
        }
        cpu.ldt.selector = selector;
    }
    function Ee(selector) {
        var sa, Yd, Wd, Rb, ie, De;
        selector &= 0xffff;
        if ((selector & 0xfffc) == 0) {
            cpu.tr.base = 0;
            cpu.tr.limit = 0;
            cpu.tr.flags = 0;
        } else {
            if (selector & 0x4)
                qd(13, selector & 0xfffc);
            sa = cpu.gdt;
            Rb = selector & ~7;
            De = 7;
            if ((Rb + De) > sa.limit)
                qd(13, selector & 0xfffc);
            fa = (sa.base + Rb) & -1;
            Yd = Cb();
            fa += 4;
            Wd = Cb();
            ie = (Wd >> 8) & 0xf;
            if ((Wd & (1 << 12)) || (ie != 1 && ie != 9))
                qd(13, selector & 0xfffc);
            if (!(Wd & (1 << 15)))
                qd(11, selector & 0xfffc);
            be(cpu.tr, Yd, Wd);
            Wd |= (1 << 9);
            Ib(Wd);
        }
        cpu.tr.selector = selector;
    }
    function Fe(Ge, selector) {
        var Yd, Wd, se, he, He, sa, Rb;
        se = cpu.cpl;
        if ((selector & 0xfffc) == 0) {
            if (Ge == 2)
                qd(13, 0);
            de(Ge, selector, 0, 0, 0);
        } else {
            if (selector & 0x4)
                sa = cpu.ldt;
            else
                sa = cpu.gdt;
            Rb = selector & ~7;
            if ((Rb + 7) > sa.limit)
                qd(13, selector & 0xfffc);
            fa = (sa.base + Rb) & -1;
            Yd = Cb();
            fa += 4;
            Wd = Cb();
            if (!(Wd & (1 << 12)))
                qd(13, selector & 0xfffc);
            He = selector & 3;
            he = (Wd >> 13) & 3;
            if (Ge == 2) {
                if ((Wd & (1 << 11)) || !(Wd & (1 << 9)))
                    qd(13, selector & 0xfffc);
                if (He != se || he != se)
                    qd(13, selector & 0xfffc);
            } else {
                if ((Wd & ((1 << 11) | (1 << 9))) == (1 << 11))
                    qd(13, selector & 0xfffc);
                if (!(Wd & (1 << 11)) || !(Wd & (1 << 10))) {
                    if (he < se || he < He)
                        qd(13, selector & 0xfffc);
                }
            }
            if (!(Wd & (1 << 15))) {
                if (Ge == 2)
                    qd(12, selector & 0xfffc);
                else
                    qd(11, selector & 0xfffc);
            }
            if (!(Wd & (1 << 8))) {
                Wd |= (1 << 8);
                Ib(Wd);
            }
            de(Ge, selector, ae(Yd, Wd), Zd(Yd, Wd), Wd);
        }
    }
    function Ie(Ge, selector) {
        var sa;
        selector &= 0xffff;
        if (!(cpu.cr0 & (1 << 0))) {
            sa = cpu.segs[Ge];
            sa.selector = selector;
            sa.base = selector << 4;
        } else if (cpu.eflags & 0x00020000) {
            fe(Ge, selector);
        } else {
            Fe(Ge, selector);
        }
    }
    function Je(Ke, Le) {
        Jb = Le, Kb = Mb = 0;
        cpu.segs[1].selector = Ke;
        cpu.segs[1].base = (Ke << 4);
        ce();
    }
    function Me(Ke, Le) {
        var Ne, ie, Yd, Wd, se, he, He, limit, e;
        if ((Ke & 0xfffc) == 0)
            qd(13, 0);
        e = Xd(Ke);
        if (!e)
            qd(13, Ke & 0xfffc);
        Yd = e[0];
        Wd = e[1];
        se = cpu.cpl;
        if (Wd & (1 << 12)) {
            if (!(Wd & (1 << 11)))
                qd(13, Ke & 0xfffc);
            he = (Wd >> 13) & 3;
            if (Wd & (1 << 10)) {
                if (he > se)
                    qd(13, Ke & 0xfffc);
            } else {
                He = Ke & 3;
                if (He > se)
                    qd(13, Ke & 0xfffc);
                if (he != se)
                    qd(13, Ke & 0xfffc);
            }
            if (!(Wd & (1 << 15)))
                qd(11, Ke & 0xfffc);
            limit = Zd(Yd, Wd);
            if ((Le >>> 0) > (limit >>> 0))
                qd(13, Ke & 0xfffc);
            de(1, (Ke & 0xfffc) | se, ae(Yd, Wd), limit, Wd);
            Jb = Le, Kb = Mb = 0;
        } else {
            nd("unsupported jump to call or task gate");
        }
    }
    function Oe(Ke, Le) {
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000)) {
            Je(Ke, Le);
        } else {
            Me(Ke, Le);
        }
    }
    function Pe(Ge, se) {
        var he, Wd;
        if ((Ge == 4 || Ge == 5) && (cpu.segs[Ge].selector & 0xfffc) == 0)
            return;
        Wd = cpu.segs[Ge].flags;
        he = (Wd >> 13) & 3;
        if (!(Wd & (1 << 11)) || !(Wd & (1 << 10))) {
            if (he < se) {
                de(Ge, 0, 0, 0, 0);
            }
        }
    }
    function Qe(je, Ke, Le, oe) {
        var le;
        le = regs[4];
        if (je) {
            {
                le = (le - 4) >> 0;
                fa = ((le & Pa) + Oa) >> 0;
                wb(cpu.segs[1].selector);
            }
            ;
            {
                le = (le - 4) >> 0;
                fa = ((le & Pa) + Oa) >> 0;
                wb(oe);
            }
            ;
        } else {
            {
                le = (le - 2) >> 0;
                fa = ((le & Pa) + Oa) >> 0;
                ub(cpu.segs[1].selector);
            }
            ;
            {
                le = (le - 2) >> 0;
                fa = ((le & Pa) + Oa) >> 0;
                ub(oe);
            }
            ;
        }
        regs[4] = (regs[4] & ~Pa) | ((le) & Pa);
        Jb = Le, Kb = Mb = 0;
        cpu.segs[1].selector = Ke;
        cpu.segs[1].base = (Ke << 4);
        ce();
    }
    function Re(je, Ke, Le, oe) {
        var ue, i, e;
        var Yd, Wd, se, he, He, selector, ve, Se;
        var ke, we, xe, Te, ie, re, Pa;
        var ga, limit, Ue;
        var qe, Ve, We;
        if ((Ke & 0xfffc) == 0)
            qd(13, 0);
        e = Xd(Ke);
        if (!e)
            qd(13, Ke & 0xfffc);
        Yd = e[0];
        Wd = e[1];
        se = cpu.cpl;
        We = regs[4];
        if (Wd & (1 << 12)) {
            if (!(Wd & (1 << 11)))
                qd(13, Ke & 0xfffc);
            he = (Wd >> 13) & 3;
            if (Wd & (1 << 10)) {
                if (he > se)
                    qd(13, Ke & 0xfffc);
            } else {
                He = Ke & 3;
                if (He > se)
                    qd(13, Ke & 0xfffc);
                if (he != se)
                    qd(13, Ke & 0xfffc);
            }
            if (!(Wd & (1 << 15)))
                qd(11, Ke & 0xfffc);
            {
                Te = We;
                Pa = Vd(cpu.segs[2].flags);
                qe = cpu.segs[2].base;
                if (je) {
                    {
                        Te = (Te - 4) & -1;
                        fa = (qe + (Te & Pa)) & -1;
                        Ib(cpu.segs[1].selector);
                    }
                    ;
                    {
                        Te = (Te - 4) & -1;
                        fa = (qe + (Te & Pa)) & -1;
                        Ib(oe);
                    }
                    ;
                } else {
                    {
                        Te = (Te - 2) & -1;
                        fa = (qe + (Te & Pa)) & -1;
                        Gb(cpu.segs[1].selector);
                    }
                    ;
                    {
                        Te = (Te - 2) & -1;
                        fa = (qe + (Te & Pa)) & -1;
                        Gb(oe);
                    }
                    ;
                }
                limit = Zd(Yd, Wd);
                if (Le > limit)
                    qd(13, Ke & 0xfffc);
                regs[4] = (regs[4] & ~Pa) | ((Te) & Pa);
                de(1, (Ke & 0xfffc) | se, ae(Yd, Wd), limit, Wd);
                Jb = Le, Kb = Mb = 0;
            }
        } else {
            ie = (Wd >> 8) & 0x1f;
            he = (Wd >> 13) & 3;
            He = Ke & 3;
            switch (ie) {
                case 1:
                case 9:
                case 5:
                    throw "unsupported task gate";
                    return;
                case 4:
                case 12:
                    break;
                default:
                    qd(13, Ke & 0xfffc);
                    break;
            }
            je = ie >> 3;
            if (he < se || he < He)
                qd(13, Ke & 0xfffc);
            if (!(Wd & (1 << 15)))
                qd(11, Ke & 0xfffc);
            selector = Yd >> 16;
            ve = (Wd & 0xffff0000) | (Yd & 0x0000ffff);
            Se = Wd & 0x1f;
            if ((selector & 0xfffc) == 0)
                qd(13, 0);
            e = Xd(selector);
            if (!e)
                qd(13, selector & 0xfffc);
            Yd = e[0];
            Wd = e[1];
            if (!(Wd & (1 << 12)) || !(Wd & ((1 << 11))))
                qd(13, selector & 0xfffc);
            he = (Wd >> 13) & 3;
            if (he > se)
                qd(13, selector & 0xfffc);
            if (!(Wd & (1 << 15)))
                qd(11, selector & 0xfffc);
            if (!(Wd & (1 << 10)) && he < se) {
                e = ge(he);
                ke = e[0];
                Te = e[1];
                if ((ke & 0xfffc) == 0)
                    qd(10, ke & 0xfffc);
                if ((ke & 3) != he)
                    qd(10, ke & 0xfffc);
                e = Xd(ke);
                if (!e)
                    qd(10, ke & 0xfffc);
                we = e[0];
                xe = e[1];
                re = (xe >> 13) & 3;
                if (re != he)
                    qd(10, ke & 0xfffc);
                if (!(xe & (1 << 12)) || (xe & (1 << 11)) || !(xe & (1 << 9)))
                    qd(10, ke & 0xfffc);
                if (!(xe & (1 << 15)))
                    qd(10, ke & 0xfffc);
                Ue = Vd(cpu.segs[2].flags);
                Ve = cpu.segs[2].base;
                Pa = Vd(xe);
                qe = ae(we, xe);
                if (je) {
                    {
                        Te = (Te - 4) & -1;
                        fa = (qe + (Te & Pa)) & -1;
                        Ib(cpu.segs[2].selector);
                    }
                    ;
                    {
                        Te = (Te - 4) & -1;
                        fa = (qe + (Te & Pa)) & -1;
                        Ib(We);
                    }
                    ;
                    for (i = Se - 1; i >= 0; i--) {
                        ga = Xe(Ve + ((We + i * 4) & Ue));
                        {
                            Te = (Te - 4) & -1;
                            fa = (qe + (Te & Pa)) & -1;
                            Ib(ga);
                        }
                        ;
                    }
                } else {
                    {
                        Te = (Te - 2) & -1;
                        fa = (qe + (Te & Pa)) & -1;
                        Gb(cpu.segs[2].selector);
                    }
                    ;
                    {
                        Te = (Te - 2) & -1;
                        fa = (qe + (Te & Pa)) & -1;
                        Gb(We);
                    }
                    ;
                    for (i = Se - 1; i >= 0; i--) {
                        ga = Ye(Ve + ((We + i * 2) & Ue));
                        {
                            Te = (Te - 2) & -1;
                            fa = (qe + (Te & Pa)) & -1;
                            Gb(ga);
                        }
                        ;
                    }
                }
                ue = 1;
            } else {
                Te = We;
                Pa = Vd(cpu.segs[2].flags);
                qe = cpu.segs[2].base;
                ue = 0;
            }
            if (je) {
                {
                    Te = (Te - 4) & -1;
                    fa = (qe + (Te & Pa)) & -1;
                    Ib(cpu.segs[1].selector);
                }
                ;
                {
                    Te = (Te - 4) & -1;
                    fa = (qe + (Te & Pa)) & -1;
                    Ib(oe);
                }
                ;
            } else {
                {
                    Te = (Te - 2) & -1;
                    fa = (qe + (Te & Pa)) & -1;
                    Gb(cpu.segs[1].selector);
                }
                ;
                {
                    Te = (Te - 2) & -1;
                    fa = (qe + (Te & Pa)) & -1;
                    Gb(oe);
                }
                ;
            }
            if (ue) {
                ke = (ke & ~3) | he;
                de(2, ke, qe, Zd(we, xe), xe);
            }
            selector = (selector & ~3) | he;
            de(1, selector, ae(Yd, Wd), Zd(Yd, Wd), Wd);
            rd(he);
            regs[4] = (regs[4] & ~Pa) | ((Te) & Pa);
            Jb = ve, Kb = Mb = 0;
        }
    }
    function Ze(je, Ke, Le, oe) {
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000)) {
            Qe(je, Ke, Le, oe);
        } else {
            Re(je, Ke, Le, oe);
        }
    }
    function af(je, bf, cf) {
        var Te, Ke, Le, df, Pa, qe, ef;
        Pa = 0xffff;
        Te = regs[4];
        qe = cpu.segs[2].base;
        if (je == 1) {
            {
                fa = (qe + (Te & Pa)) & -1;
                Le = Cb();
                Te = (Te + 4) & -1;
            }
            ;
            {
                fa = (qe + (Te & Pa)) & -1;
                Ke = Cb();
                Te = (Te + 4) & -1;
            }
            ;
            Ke &= 0xffff;
            if (bf) {
                fa = (qe + (Te & Pa)) & -1;
                df = Cb();
                Te = (Te + 4) & -1;
            }
            ;
        } else {
            {
                fa = (qe + (Te & Pa)) & -1;
                Le = Ab();
                Te = (Te + 2) & -1;
            }
            ;
            {
                fa = (qe + (Te & Pa)) & -1;
                Ke = Ab();
                Te = (Te + 2) & -1;
            }
            ;
            if (bf) {
                fa = (qe + (Te & Pa)) & -1;
                df = Ab();
                Te = (Te + 2) & -1;
            }
            ;
        }
        regs[4] = (regs[4] & ~Pa) | ((Te + cf) & Pa);
        cpu.segs[1].selector = Ke;
        cpu.segs[1].base = (Ke << 4);
        Jb = Le, Kb = Mb = 0;
        if (bf) {
            if (cpu.eflags & 0x00020000)
                ef = 0x00000100 | 0x00040000 | 0x00200000 | 0x00000200 | 0x00010000 | 0x00004000;
            else
                ef = 0x00000100 | 0x00040000 | 0x00200000 | 0x00000200 | 0x00003000 | 0x00010000 | 0x00004000;
            if (je == 0)
                ef &= 0xffff;
            kd(df, ef);
        }
        ce();
    }
    function ff(je, bf, cf) {
        var Ke, df, gf;
        var hf, jf, kf, lf;
        var e, Yd, Wd, we, xe;
        var se, he, He, ef, Sa;
        var qe, Te, Le, wd, Pa;
        Pa = Vd(cpu.segs[2].flags);
        Te = regs[4];
        qe = cpu.segs[2].base;
        df = 0;
        if (je == 1) {
            {
                fa = (qe + (Te & Pa)) & -1;
                Le = Cb();
                Te = (Te + 4) & -1;
            }
            ;
            {
                fa = (qe + (Te & Pa)) & -1;
                Ke = Cb();
                Te = (Te + 4) & -1;
            }
            ;
            Ke &= 0xffff;
            if (bf) {
                {
                    fa = (qe + (Te & Pa)) & -1;
                    df = Cb();
                    Te = (Te + 4) & -1;
                }
                ;
                if (df & 0x00020000) {
                    {
                        fa = (qe + (Te & Pa)) & -1;
                        wd = Cb();
                        Te = (Te + 4) & -1;
                    }
                    ;
                    {
                        fa = (qe + (Te & Pa)) & -1;
                        gf = Cb();
                        Te = (Te + 4) & -1;
                    }
                    ;
                    {
                        fa = (qe + (Te & Pa)) & -1;
                        hf = Cb();
                        Te = (Te + 4) & -1;
                    }
                    ;
                    {
                        fa = (qe + (Te & Pa)) & -1;
                        jf = Cb();
                        Te = (Te + 4) & -1;
                    }
                    ;
                    {
                        fa = (qe + (Te & Pa)) & -1;
                        kf = Cb();
                        Te = (Te + 4) & -1;
                    }
                    ;
                    {
                        fa = (qe + (Te & Pa)) & -1;
                        lf = Cb();
                        Te = (Te + 4) & -1;
                    }
                    ;
                    kd(df, 0x00000100 | 0x00040000 | 0x00200000 | 0x00000200 | 0x00003000 | 0x00020000 | 0x00004000 | 0x00080000 | 0x00100000);
                    fe(1, Ke & 0xffff);
                    rd(3);
                    fe(2, gf & 0xffff);
                    fe(0, hf & 0xffff);
                    fe(3, jf & 0xffff);
                    fe(4, kf & 0xffff);
                    fe(5, lf & 0xffff);
                    Jb = Le & 0xffff, Kb = Mb = 0;
                    regs[4] = (regs[4] & ~Pa) | ((wd) & Pa);
                    return;
                }
            }
        } else {
            {
                fa = (qe + (Te & Pa)) & -1;
                Le = Ab();
                Te = (Te + 2) & -1;
            }
            ;
            {
                fa = (qe + (Te & Pa)) & -1;
                Ke = Ab();
                Te = (Te + 2) & -1;
            }
            ;
            if (bf) {
                fa = (qe + (Te & Pa)) & -1;
                df = Ab();
                Te = (Te + 2) & -1;
            }
            ;
        }
        if ((Ke & 0xfffc) == 0)
            qd(13, Ke & 0xfffc);
        e = Xd(Ke);
        if (!e)
            qd(13, Ke & 0xfffc);
        Yd = e[0];
        Wd = e[1];
        if (!(Wd & (1 << 12)) || !(Wd & (1 << 11)))
            qd(13, Ke & 0xfffc);
        se = cpu.cpl;
        He = Ke & 3;
        if (He < se)
            qd(13, Ke & 0xfffc);
        he = (Wd >> 13) & 3;
        if (Wd & (1 << 10)) {
            if (he > He)
                qd(13, Ke & 0xfffc);
        } else {
            if (he != He)
                qd(13, Ke & 0xfffc);
        }
        if (!(Wd & (1 << 15)))
            qd(11, Ke & 0xfffc);
        Te = (Te + cf) & -1;
        if (He == se) {
            de(1, Ke, ae(Yd, Wd), Zd(Yd, Wd), Wd);
        } else {
            if (je == 1) {
                {
                    fa = (qe + (Te & Pa)) & -1;
                    wd = Cb();
                    Te = (Te + 4) & -1;
                }
                ;
                {
                    fa = (qe + (Te & Pa)) & -1;
                    gf = Cb();
                    Te = (Te + 4) & -1;
                }
                ;
                gf &= 0xffff;
            } else {
                {
                    fa = (qe + (Te & Pa)) & -1;
                    wd = Ab();
                    Te = (Te + 2) & -1;
                }
                ;
                {
                    fa = (qe + (Te & Pa)) & -1;
                    gf = Ab();
                    Te = (Te + 2) & -1;
                }
                ;
            }
            if ((gf & 0xfffc) == 0) {
                qd(13, 0);
            } else {
                if ((gf & 3) != He)
                    qd(13, gf & 0xfffc);
                e = Xd(gf);
                if (!e)
                    qd(13, gf & 0xfffc);
                we = e[0];
                xe = e[1];
                if (!(xe & (1 << 12)) || (xe & (1 << 11)) || !(xe & (1 << 9)))
                    qd(13, gf & 0xfffc);
                he = (xe >> 13) & 3;
                if (he != He)
                    qd(13, gf & 0xfffc);
                if (!(xe & (1 << 15)))
                    qd(11, gf & 0xfffc);
                de(2, gf, ae(we, xe), Zd(we, xe), xe);
            }
            de(1, Ke, ae(Yd, Wd), Zd(Yd, Wd), Wd);
            rd(He);
            Te = wd;
            Pa = Vd(xe);
            Pe(0, He);
            Pe(3, He);
            Pe(4, He);
            Pe(5, He);
            Te = (Te + cf) & -1;
        }
        regs[4] = (regs[4] & ~Pa) | ((Te) & Pa);
        Jb = Le, Kb = Mb = 0;
        if (bf) {
            ef = 0x00000100 | 0x00040000 | 0x00200000 | 0x00010000 | 0x00004000;
            if (se == 0)
                ef |= 0x00003000;
            Sa = (cpu.eflags >> 12) & 3;
            if (se <= Sa)
                ef |= 0x00000200;
            if (je == 0)
                ef &= 0xffff;
            kd(df, ef);
        }
    }
    function mf(je) {
        var Sa;
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000)) {
            if (cpu.eflags & 0x00020000) {
                Sa = (cpu.eflags >> 12) & 3;
                if (Sa != 3)
                    Dc(13);
            }
            af(je, 1, 0);
        } else {
            if (cpu.eflags & 0x00004000) {
                throw "unsupported task gate";
            } else {
                ff(je, 1, 0);
            }
        }
    }
    function nf(je, cf) {
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000)) {
            af(je, 0, cf);
        } else {
            ff(je, 0, cf);
        }
    }
    function of(selector, pf) {
        var e, Yd, Wd, He, he, se, ie;
        if ((selector & 0xfffc) == 0)
            return null;
        e = Xd(selector);
        if (!e)
            return null;
        Yd = e[0];
        Wd = e[1];
        He = selector & 3;
        he = (Wd >> 13) & 3;
        se = cpu.cpl;
        if (Wd & (1 << 12)) {
            if ((Wd & (1 << 11)) && (Wd & (1 << 10))) {
            } else {
                if (he < se || he < He)
                    return null;
            }
        } else {
            ie = (Wd >> 8) & 0xf;
            switch (ie) {
                case 1:
                case 2:
                case 3:
                case 9:
                case 11:
                    break;
                case 4:
                case 5:
                case 12:
                    if (pf)
                        return null;
                    break;
                default:
                    return null;
            }
            if (he < se || he < He)
                return null;
        }
        if (pf) {
            return Zd(Yd, Wd);
        } else {
            return Wd & 0x00f0ff00;
        }
    }
    function qf(je, pf) {
        var ga, Ea, Ga, selector;
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000))
            Dc(6);
        Ea = phys_mem8[Kb++];
        ;
        Ga = (Ea >> 3) & 7;
        if ((Ea >> 6) == 3) {
            selector = regs[Ea & 7] & 0xffff;
        } else {
            fa = Pb(Ea);
            selector = ib();
        }
        ga = of(selector, pf);
        _src = hd();
        if (ga === null) {
            _src &= ~0x0040;
        } else {
            _src |= 0x0040;
            if (je)
                regs[Ga] = ga;
            else
                Wb(Ga, ga);
        }
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function rf(selector, ud) {
        var e, Yd, Wd, He, he, se;
        if ((selector & 0xfffc) == 0)
            return 0;
        e = Xd(selector);
        if (!e)
            return 0;
        Yd = e[0];
        Wd = e[1];
        if (!(Wd & (1 << 12)))
            return 0;
        He = selector & 3;
        he = (Wd >> 13) & 3;
        se = cpu.cpl;
        if (Wd & (1 << 11)) {
            if (ud) {
                return 0;
            } else {
                if (!(Wd & (1 << 9)))
                    return 1;
                if (!(Wd & (1 << 10))) {
                    if (he < se || he < He)
                        return 0;
                }
            }
        } else {
            if (he < se || he < He)
                return 0;
            if (ud && !(Wd & (1 << 9)))
                return 0;
        }
        return 1;
    }
    function sf(selector, ud) {
        var z;
        z = rf(selector, ud);
        _src = hd();
        if (z)
            _src |= 0x0040;
        else
            _src &= ~0x0040;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function tf() {
        var Ea, ga, Ha, Fa;
        if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000))
            Dc(6);
        Ea = phys_mem8[Kb++];
        ;
        if ((Ea >> 6) == 3) {
            Fa = Ea & 7;
            ga = regs[Fa] & 0xffff;
        } else {
            fa = Pb(Ea);
            ga = ob();
        }
        Ha = regs[(Ea >> 3) & 7];
        _src = hd();
        if ((ga & 3) < (Ha & 3)) {
            ga = (ga & ~3) | (Ha & 3);
            if ((Ea >> 6) == 3) {
                Wb(Fa, ga);
            } else {
                ub(ga);
            }
            _src |= 0x0040;
        } else {
            _src &= ~0x0040;
        }
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function uf() {
        var Rb;
        Rb = regs[0];
        switch (Rb) {
            case 0:
                regs[0] = 1;
                regs[3] = 0x756e6547 & -1;
                regs[2] = 0x49656e69 & -1;
                regs[1] = 0x6c65746e & -1;
                break;
            case 1:
            default:
                regs[0] = (5 << 8) | (4 << 4) | 3;
                regs[3] = 8 << 8;
                regs[1] = 0;
                regs[2] = (1 << 4);
                break;
        }
    }
    function vf(base) {
        var wf, xf;
        if (base == 0)
            Dc(0);
        wf = regs[0] & 0xff;
        xf = (wf / base) & -1;
        wf = (wf % base);
        regs[0] = (regs[0] & ~0xffff) | wf | (xf << 8);
        _dst = (((wf) << 24) >> 24);
        _op = 12;
    }
    function yf(base) {
        var wf, xf;
        wf = regs[0] & 0xff;
        xf = (regs[0] >> 8) & 0xff;
        wf = (xf * base + wf) & 0xff;
        regs[0] = (regs[0] & ~0xffff) | wf;
        _dst = (((wf) << 24) >> 24);
        _op = 12;
    }
    function zf() {
        var Af, wf, xf, Bf, jd;
        jd = hd();
        Bf = jd & 0x0010;
        wf = regs[0] & 0xff;
        xf = (regs[0] >> 8) & 0xff;
        Af = (wf > 0xf9);
        if (((wf & 0x0f) > 9) || Bf) {
            wf = (wf + 6) & 0x0f;
            xf = (xf + 1 + Af) & 0xff;
            jd |= 0x0001 | 0x0010;
        } else {
            jd &= ~(0x0001 | 0x0010);
            wf &= 0x0f;
        }
        regs[0] = (regs[0] & ~0xffff) | wf | (xf << 8);
        _src = jd;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function Cf() {
        var Af, wf, xf, Bf, jd;
        jd = hd();
        Bf = jd & 0x0010;
        wf = regs[0] & 0xff;
        xf = (regs[0] >> 8) & 0xff;
        Af = (wf < 6);
        if (((wf & 0x0f) > 9) || Bf) {
            wf = (wf - 6) & 0x0f;
            xf = (xf - 1 - Af) & 0xff;
            jd |= 0x0001 | 0x0010;
        } else {
            jd &= ~(0x0001 | 0x0010);
            wf &= 0x0f;
        }
        regs[0] = (regs[0] & ~0xffff) | wf | (xf << 8);
        _src = jd;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function Df() {
        var wf, Bf, Ef, jd;
        jd = hd();
        Ef = jd & 0x0001;
        Bf = jd & 0x0010;
        wf = regs[0] & 0xff;
        jd = 0;
        if (((wf & 0x0f) > 9) || Bf) {
            wf = (wf + 6) & 0xff;
            jd |= 0x0010;
        }
        if ((wf > 0x9f) || Ef) {
            wf = (wf + 0x60) & 0xff;
            jd |= 0x0001;
        }
        regs[0] = (regs[0] & ~0xff) | wf;
        jd |= (wf == 0) << 6;
        jd |= aa[wf] << 2;
        jd |= (wf & 0x80);
        _src = jd;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function Ff() {
        var wf, Gf, Bf, Ef, jd;
        jd = hd();
        Ef = jd & 0x0001;
        Bf = jd & 0x0010;
        wf = regs[0] & 0xff;
        jd = 0;
        Gf = wf;
        if (((wf & 0x0f) > 9) || Bf) {
            jd |= 0x0010;
            if (wf < 6 || Ef)
                jd |= 0x0001;
            wf = (wf - 6) & 0xff;
        }
        if ((Gf > 0x99) || Ef) {
            wf = (wf - 0x60) & 0xff;
            jd |= 0x0001;
        }
        regs[0] = (regs[0] & ~0xff) | wf;
        jd |= (wf == 0) << 6;
        jd |= aa[wf] << 2;
        jd |= (wf & 0x80);
        _src = jd;
        _dst = ((_src >> 6) & 1) ^ 1;
        _op = 24;
    }
    function Hf() {
        var Ea, ga, Ha, Ia;
        Ea = phys_mem8[Kb++];
        ;
        if ((Ea >> 3) == 3)
            Dc(6);
        fa = Pb(Ea);
        ga = kb();
        fa = (fa + 4) & -1;
        Ha = kb();
        Ga = (Ea >> 3) & 7;
        Ia = regs[Ga];
        if (Ia < ga || Ia > Ha)
            Dc(5);
    }
    function If() {
        var Ea, ga, Ha, Ia;
        Ea = phys_mem8[Kb++];
        ;
        if ((Ea >> 3) == 3)
            Dc(6);
        fa = Pb(Ea);
        ga = (ib() << 16) >> 16;
        fa = (fa + 2) & -1;
        Ha = (ib() << 16) >> 16;
        Ga = (Ea >> 3) & 7;
        Ia = (regs[Ga] << 16) >> 16;
        if (Ia < ga || Ia > Ha)
            Dc(5);
    }
    function Jf() {
        var ga, Ha, Ga;
        Ha = (regs[4] - 16) >> 0;
        fa = ((Ha & Pa) + Oa) >> 0;
        for (Ga = 7; Ga >= 0; Ga--) {
            ga = regs[Ga];
            ub(ga);
            fa = (fa + 2) >> 0;
        }
        regs[4] = (regs[4] & ~Pa) | ((Ha) & Pa);
    }
    function Kf() {
        var ga, Ha, Ga;
        Ha = (regs[4] - 32) >> 0;
        fa = ((Ha & Pa) + Oa) >> 0;
        for (Ga = 7; Ga >= 0; Ga--) {
            ga = regs[Ga];
            wb(ga);
            fa = (fa + 4) >> 0;
        }
        regs[4] = (regs[4] & ~Pa) | ((Ha) & Pa);
    }
    function Lf() {
        var Ga;
        fa = ((regs[4] & Pa) + Oa) >> 0;
        for (Ga = 7; Ga >= 0; Ga--) {
            if (Ga != 4) {
                Wb(Ga, ib());
            }
            fa = (fa + 2) >> 0;
        }
        regs[4] = (regs[4] & ~Pa) | ((regs[4] + 16) & Pa);
    }
    function Mf() {
        var Ga;
        fa = ((regs[4] & Pa) + Oa) >> 0;
        for (Ga = 7; Ga >= 0; Ga--) {
            if (Ga != 4) {
                regs[Ga] = kb();
            }
            fa = (fa + 4) >> 0;
        }
        regs[4] = (regs[4] & ~Pa) | ((regs[4] + 32) & Pa);
    }
    function Nf() {
        var ga, Ha;
        Ha = regs[5];
        fa = ((Ha & Pa) + Oa) >> 0;
        ga = ib();
        Wb(5, ga);
        regs[4] = (regs[4] & ~Pa) | ((Ha + 2) & Pa);
    }
    function Of() {
        var ga, Ha;
        Ha = regs[5];
        fa = ((Ha & Pa) + Oa) >> 0;
        ga = kb();
        regs[5] = ga;
        regs[4] = (regs[4] & ~Pa) | ((Ha + 4) & Pa);
    }
    function Pf() {
        var cf, Qf, le, Rf, ga, Sf;
        cf = Ob();
        Qf = phys_mem8[Kb++];
        ;
        Qf &= 0x1f;
        le = regs[4];
        Rf = regs[5];
        {
            le = (le - 2) >> 0;
            fa = ((le & Pa) + Oa) >> 0;
            ub(Rf);
        }
        ;
        Sf = le;
        if (Qf != 0) {
            while (Qf > 1) {
                Rf = (Rf - 2) >> 0;
                fa = ((Rf & Pa) + Oa) >> 0;
                ga = ib();
                {
                    le = (le - 2) >> 0;
                    fa = ((le & Pa) + Oa) >> 0;
                    ub(ga);
                }
                ;
                Qf--;
            }
            {
                le = (le - 2) >> 0;
                fa = ((le & Pa) + Oa) >> 0;
                ub(Sf);
            }
            ;
        }
        le = (le - cf) >> 0;
        fa = ((le & Pa) + Oa) >> 0;
        ob();
        regs[5] = (regs[5] & ~Pa) | (Sf & Pa);
        regs[4] = le;
    }
    function Tf() {
        var cf, Qf, le, Rf, ga, Sf;
        cf = Ob();
        Qf = phys_mem8[Kb++];
        ;
        Qf &= 0x1f;
        le = regs[4];
        Rf = regs[5];
        {
            le = (le - 4) >> 0;
            fa = ((le & Pa) + Oa) >> 0;
            wb(Rf);
        }
        ;
        Sf = le;
        if (Qf != 0) {
            while (Qf > 1) {
                Rf = (Rf - 4) >> 0;
                fa = ((Rf & Pa) + Oa) >> 0;
                ga = kb();
                {
                    le = (le - 4) >> 0;
                    fa = ((le & Pa) + Oa) >> 0;
                    wb(ga);
                }
                ;
                Qf--;
            }
            {
                le = (le - 4) >> 0;
                fa = ((le & Pa) + Oa) >> 0;
                wb(Sf);
            }
            ;
        }
        le = (le - cf) >> 0;
        fa = ((le & Pa) + Oa) >> 0;
        qb();
        regs[5] = (regs[5] & ~Pa) | (Sf & Pa);
        regs[4] = (regs[4] & ~Pa) | ((le) & Pa);
    }
    function Uf(Sb) {
        var ga, Ha, Ea;
        Ea = phys_mem8[Kb++];
        ;
        if ((Ea >> 3) == 3)
            Dc(6);
        fa = Pb(Ea);
        ga = kb();
        fa += 4;
        Ha = ib();
        Ie(Sb, Ha);
        regs[(Ea >> 3) & 7] = ga;
    }
    function Vf(Sb) {
        var ga, Ha, Ea;
        Ea = phys_mem8[Kb++];
        ;
        if ((Ea >> 3) == 3)
            Dc(6);
        fa = Pb(Ea);
        ga = ib();
        fa += 2;
        Ha = ib();
        Ie(Sb, Ha);
        Wb((Ea >> 3) & 7, ga);
    }
    function Wf() {
        var Xf, Yf, Zf, ag, Sa, ga;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            Dc(13);
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        Zf = regs[2] & 0xffff;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = cpu.ld8_port(Zf);
            fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            sb(ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = cpu.ld8_port(Zf);
            fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            sb(ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function bg() {
        var Xf, cg, Sb, ag, Zf, Sa, ga;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            Dc(13);
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Zf = regs[2] & 0xffff;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            ga = gb();
            cpu.st8_port(Zf, ga);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            ga = gb();
            cpu.st8_port(Zf, ga);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
        }
    }
    function dg() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            {
                ga = gb();
                fa = eg;
                sb(ga);
                regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    Kb = Mb;
                ;
            }
        } else {
            ga = gb();
            fa = eg;
            sb(ga);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function fg() {
        var Xf, Yf, ag;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            {
                sb(regs[0]);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    Kb = Mb;
                ;
            }
        } else {
            sb(regs[0]);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function gg() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = gb();
            fa = eg;
            Ha = gb();
            gc(7, ga, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (Da & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = gb();
            fa = eg;
            Ha = gb();
            gc(7, ga, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function hg() {
        var Xf, cg, Sb, ag, ga;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = gb();
            regs[0] = (regs[0] & -256) | ga;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = gb();
            regs[0] = (regs[0] & -256) | ga;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 0)) & Xf);
        }
    }
    function ig() {
        var Xf, Yf, ag, ga;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = gb();
            gc(7, regs[0], ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (Da & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = gb();
            gc(7, regs[0], ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 0)) & Xf);
        }
    }
    function jg() {
        var Xf, Yf, Zf, ag, Sa, ga;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            Dc(13);
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        Zf = regs[2] & 0xffff;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = cpu.ld16_port(Zf);
            fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            ub(ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = cpu.ld16_port(Zf);
            fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            ub(ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function kg() {
        var Xf, cg, Sb, ag, Zf, Sa, ga;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            Dc(13);
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Zf = regs[2] & 0xffff;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            ga = ib();
            cpu.st16_port(Zf, ga);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            ga = ib();
            cpu.st16_port(Zf, ga);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
        }
    }
    function lg() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            {
                ga = ib();
                fa = eg;
                ub(ga);
                regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    Kb = Mb;
                ;
            }
        } else {
            ga = ib();
            fa = eg;
            ub(ga);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function mg() {
        var Xf, Yf, ag;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            {
                ub(regs[0]);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    Kb = Mb;
                ;
            }
        } else {
            ub(regs[0]);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function ng() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = ib();
            fa = eg;
            Ha = ib();
            dc(7, ga, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (Da & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = ib();
            fa = eg;
            Ha = ib();
            dc(7, ga, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function og() {
        var Xf, cg, Sb, ag, ga;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = ib();
            regs[0] = (regs[0] & -65536) | ga;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = ib();
            regs[0] = (regs[0] & -65536) | ga;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 1)) & Xf);
        }
    }
    function pg() {
        var Xf, Yf, ag, ga;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = ib();
            dc(7, regs[0], ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (Da & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = ib();
            dc(7, regs[0], ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 1)) & Xf);
        }
    }
    function qg() {
        var Xf, Yf, Zf, ag, Sa, ga;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            Dc(13);
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        Zf = regs[2] & 0xffff;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = cpu.ld32_port(Zf);
            fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            wb(ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = cpu.ld32_port(Zf);
            fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
            wb(ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function rg() {
        var Xf, cg, Sb, ag, Zf, Sa, ga;
        Sa = (cpu.eflags >> 12) & 3;
        if (cpu.cpl > Sa)
            Dc(13);
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Zf = regs[2] & 0xffff;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            ga = kb();
            cpu.st32_port(Zf, ga);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
            ga = kb();
            cpu.st32_port(Zf, ga);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
        }
    }
    function sg() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            if (Xf == -1 && cpu.df == 1 && ((fa | eg) & 3) == 0) {
                var tg, l, ug, vg, i, wg;
                tg = ag >>> 0;
                l = (4096 - (fa & 0xfff)) >> 2;
                if (tg > l)
                    tg = l;
                l = (4096 - (eg & 0xfff)) >> 2;
                if (tg > l)
                    tg = l;
                ug = td(fa, 0);
                vg = td(eg, 1);
                wg = tg << 2;
                vg >>= 2;
                ug >>= 2;
                for (i = 0; i < tg; i++)
                    phys_mem32[vg + i] = phys_mem32[ug + i];
                regs[6] = (cg + wg) >> 0;
                regs[7] = (Yf + wg) >> 0;
                regs[1] = ag = (ag - tg) >> 0;
                if (ag)
                    Kb = Mb;
            } else {
                ga = kb();
                fa = eg;
                wb(ga);
                regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    Kb = Mb;
                ;
            }
        } else {
            ga = kb();
            fa = eg;
            wb(ga);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function xg() {
        var Xf, Yf, ag;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            if (Xf == -1 && cpu.df == 1 && (fa & 3) == 0) {
                var tg, l, vg, i, wg, ga;
                tg = ag >>> 0;
                l = (4096 - (fa & 0xfff)) >> 2;
                if (tg > l)
                    tg = l;
                vg = td(regs[7], 1);
                ga = regs[0];
                vg >>= 2;
                for (i = 0; i < tg; i++)
                    phys_mem32[vg + i] = ga;
                wg = tg << 2;
                regs[7] = (Yf + wg) >> 0;
                regs[1] = ag = (ag - tg) >> 0;
                if (ag)
                    Kb = Mb;
            } else {
                wb(regs[0]);
                regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
                regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
                if (ag & Xf)
                    Kb = Mb;
                ;
            }
        } else {
            wb(regs[0]);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function yg() {
        var Xf, Yf, cg, ag, Sb, eg;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        Yf = regs[7];
        fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        eg = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = kb();
            fa = eg;
            Ha = kb();
            Xb(7, ga, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (Da & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = kb();
            fa = eg;
            Ha = kb();
            Xb(7, ga, Ha);
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    function zg() {
        var Xf, cg, Sb, ag, ga;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Sb = Da & 0x000f;
        if (Sb == 0)
            Sb = 3;
        else
            Sb--;
        cg = regs[6];
        fa = ((cg & Xf) + cpu.segs[Sb].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = kb();
            regs[0] = ga;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = kb();
            regs[0] = ga;
            regs[6] = (cg & ~Xf) | ((cg + (cpu.df << 2)) & Xf);
        }
    }
    function Ag() {
        var Xf, Yf, ag, ga;
        if (Da & 0x0080)
            Xf = 0xffff;
        else
            Xf = -1;
        Yf = regs[7];
        fa = ((Yf & Xf) + cpu.segs[0].base) >> 0;
        if (Da & (0x0010 | 0x0020)) {
            ag = regs[1];
            if ((ag & Xf) == 0)
                return;
            ;
            ga = kb();
            Xb(7, regs[0], ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
            regs[1] = ag = (ag & ~Xf) | ((ag - 1) & Xf);
            if (Da & 0x0010) {
                if (!(_dst == 0))
                    return;
            } else {
                if ((_dst == 0))
                    return;
            }
            if (ag & Xf)
                Kb = Mb;
            ;
        } else {
            ga = kb();
            Xb(7, regs[0], ga);
            regs[7] = (Yf & ~Xf) | ((Yf + (cpu.df << 2)) & Xf);
        }
    }
    cpu = this;
    phys_mem8 = this.phys_mem8;
    phys_mem16 = this.phys_mem16;
    phys_mem32 = this.phys_mem32;
    tlb_read_user = this.tlb_read_user;
    tlb_write_user = this.tlb_write_user;
    tlb_read_kernel = this.tlb_read_kernel;
    tlb_write_kernel = this.tlb_write_kernel;
    if (cpu.cpl == 3) {
        bb = tlb_read_user;
        cb = tlb_write_user;
    } else {
        bb = tlb_read_kernel;
        cb = tlb_write_kernel;
    }
    if (cpu.halted) {
        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200)) {
            cpu.halted = 0;
        } else {
            return 257;
        }
    }
    regs = this.regs;
    _src = this.cc_src;
    _dst = this.cc_dst;
    _op = this.cc_op;
    Ba = this.cc_op2;
    Ca = this.cc_dst2;
    Jb = this.eip;
    ce();
    La = 256;
    Ka = ua;
    if (va) {
        ;
        Ae(va.intno, 0, va.error_code, 0, 0);
    }
    if (cpu.hard_intno >= 0) {
        ;
        Ae(cpu.hard_intno, 0, 0, 0, 1);
        cpu.hard_intno = -1;
    }
    if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200)) {
        cpu.hard_intno = cpu.get_hard_intno();
        ;
        Ae(cpu.hard_intno, 0, 0, 0, 1);
        cpu.hard_intno = -1;
    }
    Kb = 0;
    Mb = 0;
    Bg: do {
        ;
        Jb = (Jb + Kb - Mb) >> 0;
        Nb = (Jb + Na) >> 0;
        Lb = bb[Nb >>> 12];
        if (((Lb | Nb) & 0xfff) >= (4096 - 15 + 1)) {
            var Cg;
            if (Lb == -1)
                fb(Nb, 0, cpu.cpl == 3);
            Lb = bb[Nb >>> 12];
            Mb = Kb = Nb ^ Lb;
            b = phys_mem8[Kb++];
            ;
            Cg = Nb & 0xfff;
            if (Cg >= (4096 - 15 + 1)) {
                ga = Cd(Nb, b);
                if ((Cg + ga) > 4096) {
                    Mb = Kb = this.mem_size;
                    for (Ha = 0; Ha < ga; Ha++) {
                        fa = (Nb + Ha) >> 0;
                        phys_mem8[Kb + Ha] = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                    }
                    Kb++;
                }
            }
        } else {
            Mb = Kb = Nb ^ Lb;
            b = phys_mem8[Kb++];
            ;
        }
        b |= (Da = Ra) & 0x0100;
        Fd: for (; ; ) {
            switch (b) {
                case 0x66:
                    if (Da == Ra)
                        Cd(Nb, b);
                    if (Ra & 0x0100)
                        Da &= ~0x0100;
                    else
                        Da |= 0x0100;
                    b = phys_mem8[Kb++];
                    ;
                    b |= (Da & 0x0100);
                    break;
                case 0x67:
                    if (Da == Ra)
                        Cd(Nb, b);
                    if (Ra & 0x0080)
                        Da &= ~0x0080;
                    else
                        Da |= 0x0080;
                    b = phys_mem8[Kb++];
                    ;
                    b |= (Da & 0x0100);
                    break;
                case 0xf0:
                    if (Da == Ra)
                        Cd(Nb, b);
                    Da |= 0x0040;
                    b = phys_mem8[Kb++];
                    ;
                    b |= (Da & 0x0100);
                    break;
                case 0xf2:
                    if (Da == Ra)
                        Cd(Nb, b);
                    Da |= 0x0020;
                    b = phys_mem8[Kb++];
                    ;
                    b |= (Da & 0x0100);
                    break;
                case 0xf3:
                    if (Da == Ra)
                        Cd(Nb, b);
                    Da |= 0x0010;
                    b = phys_mem8[Kb++];
                    ;
                    b |= (Da & 0x0100);
                    break;
                case 0x26:
                case 0x2e:
                case 0x36:
                case 0x3e:
                    if (Da == Ra)
                        Cd(Nb, b);
                    Da = (Da & ~0x000f) | (((b >> 3) & 3) + 1);
                    b = phys_mem8[Kb++];
                    ;
                    b |= (Da & 0x0100);
                    ;
                    break;
                case 0x64:
                case 0x65:
                    if (Da == Ra)
                        Cd(Nb, b);
                    Da = (Da & ~0x000f) | ((b & 7) + 1);
                    b = phys_mem8[Kb++];
                    ;
                    b |= (Da & 0x0100);
                    ;
                    break;
                case 0xb0:
                case 0xb1:
                case 0xb2:
                case 0xb3:
                case 0xb4:
                case 0xb5:
                case 0xb6:
                case 0xb7:
                    ga = phys_mem8[Kb++];
                    ;
                    b &= 7;
                    Ua = (b & 4) << 1;
                    regs[b & 3] = (regs[b & 3] & ~(0xff << Ua)) | (((ga) & 0xff) << Ua);
                    break Fd;
                case 0xb8:
                case 0xb9:
                case 0xba:
                case 0xbb:
                case 0xbc:
                case 0xbd:
                case 0xbe:
                case 0xbf:
                    {
                        ga = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    regs[b & 7] = ga;
                    break Fd;
                case 0x88:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ga = (Ea >> 3) & 7;
                    ga = (regs[Ga & 3] >> ((Ga & 4) << 1));
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        Ua = (Fa & 4) << 1;
                        regs[Fa & 3] = (regs[Fa & 3] & ~(0xff << Ua)) | (((ga) & 0xff) << Ua);
                    } else {
                        fa = Pb(Ea);
                        {
                            Ua = cb[fa >>> 12];
                            if (Ua == -1) {
                                rb(ga);
                            } else {
                                phys_mem8[fa ^ Ua] = ga;
                            }
                        }
                        ;
                    }
                    break Fd;
                case 0x89:
                    Ea = phys_mem8[Kb++];
                    ;
                    ga = regs[(Ea >> 3) & 7];
                    if ((Ea >> 6) == 3) {
                        regs[Ea & 7] = ga;
                    } else {
                        fa = Pb(Ea);
                        {
                            Ua = cb[fa >>> 12];
                            if ((Ua | fa) & 3) {
                                vb(ga);
                            } else {
                                phys_mem32[(fa ^ Ua) >> 2] = ga;
                            }
                        }
                        ;
                    }
                    break Fd;
                case 0x8a:
                    Ea = phys_mem8[Kb++];
                    ;
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                    } else {
                        fa = Pb(Ea);
                        ga = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                    }
                    Ga = (Ea >> 3) & 7;
                    Ua = (Ga & 4) << 1;
                    regs[Ga & 3] = (regs[Ga & 3] & ~(0xff << Ua)) | (((ga) & 0xff) << Ua);
                    break Fd;
                case 0x8b:
                    Ea = phys_mem8[Kb++];
                    ;
                    if ((Ea >> 6) == 3) {
                        ga = regs[Ea & 7];
                    } else {
                        fa = Pb(Ea);
                        ga = (((Ua = bb[fa >>> 12]) | fa) & 3 ? jb() : phys_mem32[(fa ^ Ua) >> 2]);
                    }
                    regs[(Ea >> 3) & 7] = ga;
                    break Fd;
                case 0xa0:
                    fa = Ub();
                    ga = gb();
                    regs[0] = (regs[0] & -256) | ga;
                    break Fd;
                case 0xa1:
                    fa = Ub();
                    ga = kb();
                    regs[0] = ga;
                    break Fd;
                case 0xa2:
                    fa = Ub();
                    sb(regs[0]);
                    break Fd;
                case 0xa3:
                    fa = Ub();
                    wb(regs[0]);
                    break Fd;
                case 0xd7:
                    fa = (regs[3] + (regs[0] & 0xff)) >> 0;
                    if (Da & 0x0080)
                        fa &= 0xffff;
                    Ga = Da & 0x000f;
                    if (Ga == 0)
                        Ga = 3;
                    else
                        Ga--;
                    fa = (fa + cpu.segs[Ga].base) >> 0;
                    ga = gb();
                    Vb(0, ga);
                    break Fd;
                case 0xc6:
                    Ea = phys_mem8[Kb++];
                    ;
                    if ((Ea >> 6) == 3) {
                        ga = phys_mem8[Kb++];
                        ;
                        Vb(Ea & 7, ga);
                    } else {
                        fa = Pb(Ea);
                        ga = phys_mem8[Kb++];
                        ;
                        sb(ga);
                    }
                    break Fd;
                case 0xc7:
                    Ea = phys_mem8[Kb++];
                    ;
                    if ((Ea >> 6) == 3) {
                        {
                            ga = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                            Kb += 4;
                        }
                        ;
                        regs[Ea & 7] = ga;
                    } else {
                        fa = Pb(Ea);
                        {
                            ga = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                            Kb += 4;
                        }
                        ;
                        wb(ga);
                    }
                    break Fd;
                case 0x91:
                case 0x92:
                case 0x93:
                case 0x94:
                case 0x95:
                case 0x96:
                case 0x97:
                    Ga = b & 7;
                    ga = regs[0];
                    regs[0] = regs[Ga];
                    regs[Ga] = ga;
                    break Fd;
                case 0x86:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ga = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                        Vb(Fa, (regs[Ga & 3] >> ((Ga & 4) << 1)));
                    } else {
                        fa = Pb(Ea);
                        ga = mb();
                        sb((regs[Ga & 3] >> ((Ga & 4) << 1)));
                    }
                    Vb(Ga, ga);
                    break Fd;
                case 0x87:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ga = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        ga = regs[Fa];
                        regs[Fa] = regs[Ga];
                    } else {
                        fa = Pb(Ea);
                        ga = qb();
                        wb(regs[Ga]);
                    }
                    regs[Ga] = ga;
                    break Fd;
                case 0x8e:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ga = (Ea >> 3) & 7;
                    if (Ga >= 6 || Ga == 1)
                        Dc(6);
                    if ((Ea >> 6) == 3) {
                        ga = regs[Ea & 7] & 0xffff;
                    } else {
                        fa = Pb(Ea);
                        ga = ib();
                    }
                    Ie(Ga, ga);
                    break Fd;
                case 0x8c:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ga = (Ea >> 3) & 7;
                    if (Ga >= 6)
                        Dc(6);
                    ga = cpu.segs[Ga].selector;
                    if ((Ea >> 6) == 3) {
                        if ((((Da >> 8) & 1) ^ 1)) {
                            regs[Ea & 7] = ga;
                        } else {
                            Wb(Ea & 7, ga);
                        }
                    } else {
                        fa = Pb(Ea);
                        ub(ga);
                    }
                    break Fd;
                case 0xc4:
                    Uf(0);
                    break Fd;
                case 0xc5:
                    Uf(3);
                    break Fd;
                case 0x00:
                case 0x08:
                case 0x10:
                case 0x18:
                case 0x20:
                case 0x28:
                case 0x30:
                case 0x38:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = b >> 3;
                    Ga = (Ea >> 3) & 7;
                    Ha = (regs[Ga & 3] >> ((Ga & 4) << 1));
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        Vb(Fa, gc(Ja, (regs[Fa & 3] >> ((Fa & 4) << 1)), Ha));
                    } else {
                        fa = Pb(Ea);
                        if (Ja != 7) {
                            ga = mb();
                            ga = gc(Ja, ga, Ha);
                            sb(ga);
                        } else {
                            ga = gb();
                            gc(7, ga, Ha);
                        }
                    }
                    break Fd;
                case 0x01:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ha = regs[(Ea >> 3) & 7];
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        {
                            _src = Ha;
                            _dst = regs[Fa] = (regs[Fa] + _src) >> 0;
                            _op = 2;
                        }
                        ;
                    } else {
                        fa = Pb(Ea);
                        ga = qb();
                        {
                            _src = Ha;
                            _dst = ga = (ga + _src) >> 0;
                            _op = 2;
                        }
                        ;
                        wb(ga);
                    }
                    break Fd;
                case 0x09:
                case 0x11:
                case 0x19:
                case 0x21:
                case 0x29:
                case 0x31:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = b >> 3;
                    Ha = regs[(Ea >> 3) & 7];
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        regs[Fa] = Xb(Ja, regs[Fa], Ha);
                    } else {
                        fa = Pb(Ea);
                        ga = qb();
                        ga = Xb(Ja, ga, Ha);
                        wb(ga);
                    }
                    break Fd;
                case 0x39:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = b >> 3;
                    Ha = regs[(Ea >> 3) & 7];
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        {
                            _src = Ha;
                            _dst = (regs[Fa] - _src) >> 0;
                            _op = 8;
                        }
                        ;
                    } else {
                        fa = Pb(Ea);
                        ga = kb();
                        {
                            _src = Ha;
                            _dst = (ga - _src) >> 0;
                            _op = 8;
                        }
                        ;
                    }
                    break Fd;
                case 0x02:
                case 0x0a:
                case 0x12:
                case 0x1a:
                case 0x22:
                case 0x2a:
                case 0x32:
                case 0x3a:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = b >> 3;
                    Ga = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        Ha = (regs[Fa & 3] >> ((Fa & 4) << 1));
                    } else {
                        fa = Pb(Ea);
                        Ha = gb();
                    }
                    Vb(Ga, gc(Ja, (regs[Ga & 3] >> ((Ga & 4) << 1)), Ha));
                    break Fd;
                case 0x03:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ga = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Ha = regs[Ea & 7];
                    } else {
                        fa = Pb(Ea);
                        Ha = kb();
                    }
                    {
                        _src = Ha;
                        _dst = regs[Ga] = (regs[Ga] + _src) >> 0;
                        _op = 2;
                    }
                    ;
                    break Fd;
                case 0x0b:
                case 0x13:
                case 0x1b:
                case 0x23:
                case 0x2b:
                case 0x33:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = b >> 3;
                    Ga = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Ha = regs[Ea & 7];
                    } else {
                        fa = Pb(Ea);
                        Ha = kb();
                    }
                    regs[Ga] = Xb(Ja, regs[Ga], Ha);
                    break Fd;
                case 0x3b:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = b >> 3;
                    Ga = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Ha = regs[Ea & 7];
                    } else {
                        fa = Pb(Ea);
                        Ha = kb();
                    }
                    {
                        _src = Ha;
                        _dst = (regs[Ga] - _src) >> 0;
                        _op = 8;
                    }
                    ;
                    break Fd;
                case 0x04:
                case 0x0c:
                case 0x14:
                case 0x1c:
                case 0x24:
                case 0x2c:
                case 0x34:
                case 0x3c:
                    Ha = phys_mem8[Kb++];
                    ;
                    Ja = b >> 3;
                    Vb(0, gc(Ja, regs[0] & 0xff, Ha));
                    break Fd;
                case 0x05:
                    {
                        Ha = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    {
                        _src = Ha;
                        _dst = regs[0] = (regs[0] + _src) >> 0;
                        _op = 2;
                    }
                    ;
                    break Fd;
                case 0x0d:
                case 0x15:
                case 0x1d:
                case 0x25:
                case 0x2d:
                    {
                        Ha = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    Ja = b >> 3;
                    regs[0] = Xb(Ja, regs[0], Ha);
                    break Fd;
                case 0x35:
                    {
                        Ha = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    {
                        _dst = regs[0] = regs[0] ^ Ha;
                        _op = 14;
                    }
                    ;
                    break Fd;
                case 0x3d:
                    {
                        Ha = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    {
                        _src = Ha;
                        _dst = (regs[0] - _src) >> 0;
                        _op = 8;
                    }
                    ;
                    break Fd;
                case 0x80:
                case 0x82:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        Ha = phys_mem8[Kb++];
                        ;
                        Vb(Fa, gc(Ja, (regs[Fa & 3] >> ((Fa & 4) << 1)), Ha));
                    } else {
                        fa = Pb(Ea);
                        Ha = phys_mem8[Kb++];
                        ;
                        if (Ja != 7) {
                            ga = mb();
                            ga = gc(Ja, ga, Ha);
                            sb(ga);
                        } else {
                            ga = gb();
                            gc(7, ga, Ha);
                        }
                    }
                    break Fd;
                case 0x81:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    if (Ja == 7) {
                        if ((Ea >> 6) == 3) {
                            ga = regs[Ea & 7];
                        } else {
                            fa = Pb(Ea);
                            ga = kb();
                        }
                        {
                            Ha = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                            Kb += 4;
                        }
                        ;
                        {
                            _src = Ha;
                            _dst = (ga - _src) >> 0;
                            _op = 8;
                        }
                        ;
                    } else {
                        if ((Ea >> 6) == 3) {
                            Fa = Ea & 7;
                            {
                                Ha = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                                Kb += 4;
                            }
                            ;
                            regs[Fa] = Xb(Ja, regs[Fa], Ha);
                        } else {
                            fa = Pb(Ea);
                            {
                                Ha = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                                Kb += 4;
                            }
                            ;
                            ga = qb();
                            ga = Xb(Ja, ga, Ha);
                            wb(ga);
                        }
                    }
                    break Fd;
                case 0x83:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    if (Ja == 7) {
                        if ((Ea >> 6) == 3) {
                            ga = regs[Ea & 7];
                        } else {
                            fa = Pb(Ea);
                            ga = kb();
                        }
                        Ha = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        {
                            _src = Ha;
                            _dst = (ga - _src) >> 0;
                            _op = 8;
                        }
                        ;
                    } else {
                        if ((Ea >> 6) == 3) {
                            Fa = Ea & 7;
                            Ha = ((phys_mem8[Kb++] << 24) >> 24);
                            ;
                            regs[Fa] = Xb(Ja, regs[Fa], Ha);
                        } else {
                            fa = Pb(Ea);
                            Ha = ((phys_mem8[Kb++] << 24) >> 24);
                            ;
                            ga = qb();
                            ga = Xb(Ja, ga, Ha);
                            wb(ga);
                        }
                    }
                    break Fd;
                case 0x40:
                case 0x41:
                case 0x42:
                case 0x43:
                case 0x44:
                case 0x45:
                case 0x46:
                case 0x47:
                    Ga = b & 7;
                    {
                        if (_op < 25) {
                            Ba = _op;
                            Ca = _dst;
                        }
                        regs[Ga] = _dst = (regs[Ga] + 1) >> 0;
                        _op = 27;
                    }
                    ;
                    break Fd;
                case 0x48:
                case 0x49:
                case 0x4a:
                case 0x4b:
                case 0x4c:
                case 0x4d:
                case 0x4e:
                case 0x4f:
                    Ga = b & 7;
                    {
                        if (_op < 25) {
                            Ba = _op;
                            Ca = _dst;
                        }
                        regs[Ga] = _dst = (regs[Ga] - 1) >> 0;
                        _op = 30;
                    }
                    ;
                    break Fd;
                case 0x6b:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ga = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Ha = regs[Ea & 7];
                    } else {
                        fa = Pb(Ea);
                        Ha = kb();
                    }
                    Ia = ((phys_mem8[Kb++] << 24) >> 24);
                    ;
                    regs[Ga] = Wc(Ha, Ia);
                    break Fd;
                case 0x69:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ga = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Ha = regs[Ea & 7];
                    } else {
                        fa = Pb(Ea);
                        Ha = kb();
                    }
                    {
                        Ia = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    regs[Ga] = Wc(Ha, Ia);
                    break Fd;
                case 0x84:
                    Ea = phys_mem8[Kb++];
                    ;
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                    } else {
                        fa = Pb(Ea);
                        ga = gb();
                    }
                    Ga = (Ea >> 3) & 7;
                    Ha = (regs[Ga & 3] >> ((Ga & 4) << 1));
                    {
                        _dst = (((ga & Ha) << 24) >> 24);
                        _op = 12;
                    }
                    ;
                    break Fd;
                case 0x85:
                    Ea = phys_mem8[Kb++];
                    ;
                    if ((Ea >> 6) == 3) {
                        ga = regs[Ea & 7];
                    } else {
                        fa = Pb(Ea);
                        ga = kb();
                    }
                    Ha = regs[(Ea >> 3) & 7];
                    {
                        _dst = ga & Ha;
                        _op = 14;
                    }
                    ;
                    break Fd;
                case 0xa8:
                    Ha = phys_mem8[Kb++];
                    ;
                    {
                        _dst = (((regs[0] & Ha) << 24) >> 24);
                        _op = 12;
                    }
                    ;
                    break Fd;
                case 0xa9:
                    {
                        Ha = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    {
                        _dst = regs[0] & Ha;
                        _op = 14;
                    }
                    ;
                    break Fd;
                case 0xf6:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    switch (Ja) {
                        case 0:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                            } else {
                                fa = Pb(Ea);
                                ga = gb();
                            }
                            Ha = phys_mem8[Kb++];
                            ;
                            {
                                _dst = (((ga & Ha) << 24) >> 24);
                                _op = 12;
                            }
                            ;
                            break;
                        case 2:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                Vb(Fa, ~(regs[Fa & 3] >> ((Fa & 4) << 1)));
                            } else {
                                fa = Pb(Ea);
                                ga = mb();
                                ga = ~ga;
                                sb(ga);
                            }
                            break;
                        case 3:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                Vb(Fa, gc(5, 0, (regs[Fa & 3] >> ((Fa & 4) << 1))));
                            } else {
                                fa = Pb(Ea);
                                ga = mb();
                                ga = gc(5, 0, ga);
                                sb(ga);
                            }
                            break;
                        case 4:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                            } else {
                                fa = Pb(Ea);
                                ga = gb();
                            }
                            Wb(0, Oc(regs[0], ga));
                            break;
                        case 5:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                            } else {
                                fa = Pb(Ea);
                                ga = gb();
                            }
                            Wb(0, Pc(regs[0], ga));
                            break;
                        case 6:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                            } else {
                                fa = Pb(Ea);
                                ga = gb();
                            }
                            Cc(ga);
                            break;
                        case 7:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                            } else {
                                fa = Pb(Ea);
                                ga = gb();
                            }
                            Ec(ga);
                            break;
                        default:
                            Dc(6);
                    }
                    break Fd;
                case 0xf7:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    switch (Ja) {
                        case 0:
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = kb();
                            }
                            {
                                Ha = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                                Kb += 4;
                            }
                            ;
                            {
                                _dst = ga & Ha;
                                _op = 14;
                            }
                            ;
                            break;
                        case 2:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                regs[Fa] = ~regs[Fa];
                            } else {
                                fa = Pb(Ea);
                                ga = qb();
                                ga = ~ga;
                                wb(ga);
                            }
                            break;
                        case 3:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                regs[Fa] = Xb(5, 0, regs[Fa]);
                            } else {
                                fa = Pb(Ea);
                                ga = qb();
                                ga = Xb(5, 0, ga);
                                wb(ga);
                            }
                            break;
                        case 4:
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = kb();
                            }
                            regs[0] = Vc(regs[0], ga);
                            regs[2] = Ma;
                            break;
                        case 5:
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = kb();
                            }
                            regs[0] = Wc(regs[0], ga);
                            regs[2] = Ma;
                            break;
                        case 6:
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = kb();
                            }
                            regs[0] = Hc(regs[2], regs[0], ga);
                            regs[2] = Ma;
                            break;
                        case 7:
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = kb();
                            }
                            regs[0] = Lc(regs[2], regs[0], ga);
                            regs[2] = Ma;
                            break;
                        default:
                            Dc(6);
                    }
                    break Fd;
                case 0xc0:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Ha = phys_mem8[Kb++];
                        ;
                        Fa = Ea & 7;
                        Vb(Fa, jc(Ja, (regs[Fa & 3] >> ((Fa & 4) << 1)), Ha));
                    } else {
                        fa = Pb(Ea);
                        Ha = phys_mem8[Kb++];
                        ;
                        ga = mb();
                        ga = jc(Ja, ga, Ha);
                        sb(ga);
                    }
                    break Fd;
                case 0xc1:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Ha = phys_mem8[Kb++];
                        ;
                        Fa = Ea & 7;
                        regs[Fa] = nc(Ja, regs[Fa], Ha);
                    } else {
                        fa = Pb(Ea);
                        Ha = phys_mem8[Kb++];
                        ;
                        ga = qb();
                        ga = nc(Ja, ga, Ha);
                        wb(ga);
                    }
                    break Fd;
                case 0xd0:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        Vb(Fa, jc(Ja, (regs[Fa & 3] >> ((Fa & 4) << 1)), 1));
                    } else {
                        fa = Pb(Ea);
                        ga = mb();
                        ga = jc(Ja, ga, 1);
                        sb(ga);
                    }
                    break Fd;
                case 0xd1:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        regs[Fa] = nc(Ja, regs[Fa], 1);
                    } else {
                        fa = Pb(Ea);
                        ga = qb();
                        ga = nc(Ja, ga, 1);
                        wb(ga);
                    }
                    break Fd;
                case 0xd2:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    Ha = regs[1] & 0xff;
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        Vb(Fa, jc(Ja, (regs[Fa & 3] >> ((Fa & 4) << 1)), Ha));
                    } else {
                        fa = Pb(Ea);
                        ga = mb();
                        ga = jc(Ja, ga, Ha);
                        sb(ga);
                    }
                    break Fd;
                case 0xd3:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    Ha = regs[1] & 0xff;
                    if ((Ea >> 6) == 3) {
                        Fa = Ea & 7;
                        regs[Fa] = nc(Ja, regs[Fa], Ha);
                    } else {
                        fa = Pb(Ea);
                        ga = qb();
                        ga = nc(Ja, ga, Ha);
                        wb(ga);
                    }
                    break Fd;
                case 0x98:
                    regs[0] = (regs[0] << 16) >> 16;
                    break Fd;
                case 0x99:
                    regs[2] = regs[0] >> 31;
                    break Fd;
                case 0x50:
                case 0x51:
                case 0x52:
                case 0x53:
                case 0x54:
                case 0x55:
                case 0x56:
                case 0x57:
                    ga = regs[b & 7];
                    if (Qa) {
                        fa = (regs[4] - 4) >> 0;
                        {
                            Ua = cb[fa >>> 12];
                            if ((Ua | fa) & 3) {
                                vb(ga);
                            } else {
                                phys_mem32[(fa ^ Ua) >> 2] = ga;
                            }
                        }
                        ;
                        regs[4] = fa;
                    } else {
                        xd(ga);
                    }
                    break Fd;
                case 0x58:
                case 0x59:
                case 0x5a:
                case 0x5b:
                case 0x5c:
                case 0x5d:
                case 0x5e:
                case 0x5f:
                    if (Qa) {
                        fa = regs[4];
                        ga = (((Ua = bb[fa >>> 12]) | fa) & 3 ? jb() : phys_mem32[(fa ^ Ua) >> 2]);
                        regs[4] = (fa + 4) >> 0;
                    } else {
                        ga = Ad();
                        Bd();
                    }
                    regs[b & 7] = ga;
                    break Fd;
                case 0x60:
                    Kf();
                    break Fd;
                case 0x61:
                    Mf();
                    break Fd;
                case 0x8f:
                    Ea = phys_mem8[Kb++];
                    ;
                    if ((Ea >> 6) == 3) {
                        ga = Ad();
                        Bd();
                        regs[Ea & 7] = ga;
                    } else {
                        ga = Ad();
                        Ha = regs[4];
                        Bd();
                        Ia = regs[4];
                        fa = Pb(Ea);
                        regs[4] = Ha;
                        wb(ga);
                        regs[4] = Ia;
                    }
                    break Fd;
                case 0x68:
                    {
                        ga = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    if (Qa) {
                        fa = (regs[4] - 4) >> 0;
                        wb(ga);
                        regs[4] = fa;
                    } else {
                        xd(ga);
                    }
                    break Fd;
                case 0x6a:
                    ga = ((phys_mem8[Kb++] << 24) >> 24);
                    ;
                    if (Qa) {
                        fa = (regs[4] - 4) >> 0;
                        wb(ga);
                        regs[4] = fa;
                    } else {
                        xd(ga);
                    }
                    break Fd;
                case 0xc8:
                    Tf();
                    break Fd;
                case 0xc9:
                    if (Qa) {
                        fa = regs[5];
                        ga = kb();
                        regs[5] = ga;
                        regs[4] = (fa + 4) >> 0;
                    } else {
                        Of();
                    }
                    break Fd;
                case 0x9c:
                    Sa = (cpu.eflags >> 12) & 3;
                    if ((cpu.eflags & 0x00020000) && Sa != 3)
                        Dc(13);
                    ga = id() & ~(0x00020000 | 0x00010000);
                    if ((((Da >> 8) & 1) ^ 1)) {
                        xd(ga);
                    } else {
                        vd(ga);
                    }
                    break Fd;
                case 0x9d:
                    Sa = (cpu.eflags >> 12) & 3;
                    if ((cpu.eflags & 0x00020000) && Sa != 3)
                        Dc(13);
                    if ((((Da >> 8) & 1) ^ 1)) {
                        ga = Ad();
                        Bd();
                        Ha = -1;
                    } else {
                        ga = yd();
                        zd();
                        Ha = 0xffff;
                    }
                    Ia = (0x00000100 | 0x00040000 | 0x00200000 | 0x00004000);
                    if (cpu.cpl == 0) {
                        Ia |= 0x00000200 | 0x00003000;
                    } else {
                        if (cpu.cpl <= Sa)
                            Ia |= 0x00000200;
                    }
                    kd(ga, Ia & Ha);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0x06:
                case 0x0e:
                case 0x16:
                case 0x1e:
                    xd(cpu.segs[b >> 3].selector);
                    break Fd;
                case 0x07:
                case 0x17:
                case 0x1f:
                    Ie(b >> 3, Ad() & 0xffff);
                    Bd();
                    break Fd;
                case 0x8d:
                    Ea = phys_mem8[Kb++];
                    ;
                    if ((Ea >> 6) == 3)
                        Dc(6);
                    Da = (Da & ~0x000f) | (6 + 1);
                    regs[(Ea >> 3) & 7] = Pb(Ea);
                    break Fd;
                case 0xfe:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    switch (Ja) {
                        case 0:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                Vb(Fa, hc((regs[Fa & 3] >> ((Fa & 4) << 1))));
                            } else {
                                fa = Pb(Ea);
                                ga = mb();
                                ga = hc(ga);
                                sb(ga);
                            }
                            break;
                        case 1:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                Vb(Fa, ic((regs[Fa & 3] >> ((Fa & 4) << 1))));
                            } else {
                                fa = Pb(Ea);
                                ga = mb();
                                ga = ic(ga);
                                sb(ga);
                            }
                            break;
                        default:
                            Dc(6);
                    }
                    break Fd;
                case 0xff:
                    Ea = phys_mem8[Kb++];
                    ;
                    Ja = (Ea >> 3) & 7;
                    switch (Ja) {
                        case 0:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                {
                                    if (_op < 25) {
                                        Ba = _op;
                                        Ca = _dst;
                                    }
                                    regs[Fa] = _dst = (regs[Fa] + 1) >> 0;
                                    _op = 27;
                                }
                                ;
                            } else {
                                fa = Pb(Ea);
                                ga = qb();
                                {
                                    if (_op < 25) {
                                        Ba = _op;
                                        Ca = _dst;
                                    }
                                    ga = _dst = (ga + 1) >> 0;
                                    _op = 27;
                                }
                                ;
                                wb(ga);
                            }
                            break;
                        case 1:
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                {
                                    if (_op < 25) {
                                        Ba = _op;
                                        Ca = _dst;
                                    }
                                    regs[Fa] = _dst = (regs[Fa] - 1) >> 0;
                                    _op = 30;
                                }
                                ;
                            } else {
                                fa = Pb(Ea);
                                ga = qb();
                                {
                                    if (_op < 25) {
                                        Ba = _op;
                                        Ca = _dst;
                                    }
                                    ga = _dst = (ga - 1) >> 0;
                                    _op = 30;
                                }
                                ;
                                wb(ga);
                            }
                            break;
                        case 2:
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = kb();
                            }
                            Ha = (Jb + Kb - Mb);
                            if (Qa) {
                                fa = (regs[4] - 4) >> 0;
                                wb(Ha);
                                regs[4] = fa;
                            } else {
                                xd(Ha);
                            }
                            Jb = ga, Kb = Mb = 0;
                            break;
                        case 4:
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = kb();
                            }
                            Jb = ga, Kb = Mb = 0;
                            break;
                        case 6:
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = kb();
                            }
                            if (Qa) {
                                fa = (regs[4] - 4) >> 0;
                                wb(ga);
                                regs[4] = fa;
                            } else {
                                xd(ga);
                            }
                            break;
                        case 3:
                        case 5:
                            if ((Ea >> 6) == 3)
                                Dc(6);
                            fa = Pb(Ea);
                            ga = kb();
                            fa = (fa + 4) >> 0;
                            Ha = ib();
                            if (Ja == 3)
                                Ze(1, Ha, ga, (Jb + Kb - Mb));
                            else
                                Oe(Ha, ga);
                            break;
                        default:
                            Dc(6);
                    }
                    break Fd;
                case 0xeb:
                    ga = ((phys_mem8[Kb++] << 24) >> 24);
                    ;
                    Kb = (Kb + ga) >> 0;
                    break Fd;
                case 0xe9:
                    {
                        ga = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    Kb = (Kb + ga) >> 0;
                    break Fd;
                case 0xea:
                    if ((((Da >> 8) & 1) ^ 1)) {
                        {
                            ga = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                            Kb += 4;
                        }
                        ;
                    } else {
                        ga = Ob();
                    }
                    Ha = Ob();
                    Oe(Ha, ga);
                    break Fd;
                case 0x70:
                    if (Zc()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x71:
                    if (!Zc()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x72:
                    if (bc()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x73:
                    if (!bc()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x74:
                    if ((_dst == 0)) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x75:
                    if (!(_dst == 0)) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x76:
                    if (ad()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x77:
                    if (!ad()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x78:
                    if ((_op == 24 ? ((_src >> 7) & 1) : (_dst < 0))) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x79:
                    if (!(_op == 24 ? ((_src >> 7) & 1) : (_dst < 0))) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x7a:
                    if (bd()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x7b:
                    if (!bd()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x7c:
                    if (cd()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x7d:
                    if (!cd()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x7e:
                    if (dd()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0x7f:
                    if (!dd()) {
                        ga = ((phys_mem8[Kb++] << 24) >> 24);
                        ;
                        Kb = (Kb + ga) >> 0;
                    } else {
                        Kb = (Kb + 1) >> 0;
                    }
                    break Fd;
                case 0xe0:
                case 0xe1:
                case 0xe2:
                    ga = ((phys_mem8[Kb++] << 24) >> 24);
                    ;
                    if (Da & 0x0080)
                        Ja = 0xffff;
                    else
                        Ja = -1;
                    Ha = (regs[1] - 1) & Ja;
                    regs[1] = (regs[1] & ~Ja) | Ha;
                    b &= 3;
                    if (b == 0)
                        Ia = !(_dst == 0);
                    else if (b == 1)
                        Ia = (_dst == 0);
                    else
                        Ia = 1;
                    if (Ha && Ia) {
                        if (Da & 0x0100) {
                            Jb = (Jb + Kb - Mb + ga) & 0xffff, Kb = Mb = 0;
                        } else {
                            Kb = (Kb + ga) >> 0;
                        }
                    }
                    break Fd;
                case 0xe3:
                    ga = ((phys_mem8[Kb++] << 24) >> 24);
                    ;
                    if (Da & 0x0080)
                        Ja = 0xffff;
                    else
                        Ja = -1;
                    if ((regs[1] & Ja) == 0) {
                        if (Da & 0x0100) {
                            Jb = (Jb + Kb - Mb + ga) & 0xffff, Kb = Mb = 0;
                        } else {
                            Kb = (Kb + ga) >> 0;
                        }
                    }
                    break Fd;
                case 0xc2:
                    Ha = (Ob() << 16) >> 16;
                    ga = Ad();
                    regs[4] = (regs[4] & ~Pa) | ((regs[4] + 4 + Ha) & Pa);
                    Jb = ga, Kb = Mb = 0;
                    break Fd;
                case 0xc3:
                    if (Qa) {
                        fa = regs[4];
                        ga = kb();
                        regs[4] = (regs[4] + 4) >> 0;
                    } else {
                        ga = Ad();
                        Bd();
                    }
                    Jb = ga, Kb = Mb = 0;
                    break Fd;
                case 0xe8:
                    {
                        ga = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                        Kb += 4;
                    }
                    ;
                    Ha = (Jb + Kb - Mb);
                    if (Qa) {
                        fa = (regs[4] - 4) >> 0;
                        wb(Ha);
                        regs[4] = fa;
                    } else {
                        xd(Ha);
                    }
                    Kb = (Kb + ga) >> 0;
                    break Fd;
                case 0x9a:
                    Ia = (((Da >> 8) & 1) ^ 1);
                    if (Ia) {
                        {
                            ga = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                            Kb += 4;
                        }
                        ;
                    } else {
                        ga = Ob();
                    }
                    Ha = Ob();
                    Ze(Ia, Ha, ga, (Jb + Kb - Mb));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xca:
                    Ha = (Ob() << 16) >> 16;
                    nf((((Da >> 8) & 1) ^ 1), Ha);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xcb:
                    nf((((Da >> 8) & 1) ^ 1), 0);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xcf:
                    mf((((Da >> 8) & 1) ^ 1));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0x90:
                    break Fd;
                case 0xcc:
                    Ha = (Jb + Kb - Mb);
                    Ae(3, 1, 0, Ha, 0);
                    break Fd;
                case 0xcd:
                    ga = phys_mem8[Kb++];
                    ;
                    if ((cpu.eflags & 0x00020000) && ((cpu.eflags >> 12) & 3) != 3)
                        Dc(13);
                    Ha = (Jb + Kb - Mb);
                    Ae(ga, 1, 0, Ha, 0);
                    break Fd;
                case 0xce:
                    if (Zc()) {
                        Ha = (Jb + Kb - Mb);
                        Ae(4, 1, 0, Ha, 0);
                    }
                    break Fd;
                case 0x62:
                    Hf();
                    break Fd;
                case 0xf5:
                    _src = hd() ^ 0x0001;
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                case 0xf8:
                    _src = hd() & ~0x0001;
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                case 0xf9:
                    _src = hd() | 0x0001;
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                case 0xfc:
                    cpu.df = 1;
                    break Fd;
                case 0xfd:
                    cpu.df = -1;
                    break Fd;
                case 0xfa:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        Dc(13);
                    cpu.eflags &= ~0x00000200;
                    break Fd;
                case 0xfb:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        Dc(13);
                    cpu.eflags |= 0x00000200;
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0x9e:
                    _src = ((regs[0] >> 8) & (0x0080 | 0x0040 | 0x0010 | 0x0004 | 0x0001)) | (Zc() << 11);
                    _dst = ((_src >> 6) & 1) ^ 1;
                    _op = 24;
                    break Fd;
                case 0x9f:
                    ga = id();
                    Vb(4, ga);
                    break Fd;
                case 0xf4:
                    if (cpu.cpl != 0)
                        Dc(13);
                    cpu.halted = 1;
                    La = 257;
                    break Bg;
                case 0xa4:
                    dg();
                    break Fd;
                case 0xa5:
                    sg();
                    break Fd;
                case 0xaa:
                    fg();
                    break Fd;
                case 0xab:
                    xg();
                    break Fd;
                case 0xa6:
                    gg();
                    break Fd;
                case 0xa7:
                    yg();
                    break Fd;
                case 0xac:
                    hg();
                    break Fd;
                case 0xad:
                    zg();
                    break Fd;
                case 0xae:
                    ig();
                    break Fd;
                case 0xaf:
                    Ag();
                    break Fd;
                case 0x6c:
                    Wf();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0x6d:
                    qg();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0x6e:
                    bg();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0x6f:
                    rg();
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xd8:
                case 0xd9:
                case 0xda:
                case 0xdb:
                case 0xdc:
                case 0xdd:
                case 0xde:
                case 0xdf:
                    if (cpu.cr0 & ((1 << 2) | (1 << 3))) {
                        Dc(7);
                    }
                    Ea = phys_mem8[Kb++];
                    ;
                    Ga = (Ea >> 3) & 7;
                    Fa = Ea & 7;
                    Ja = ((b & 7) << 3) | ((Ea >> 3) & 7);
                    Wb(0, 0xffff);
                    if ((Ea >> 6) == 3) {
                    } else {
                        fa = Pb(Ea);
                    }
                    break Fd;
                case 0x9b:
                    break Fd;
                case 0xe4:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        Dc(13);
                    ga = phys_mem8[Kb++];
                    ;
                    Vb(0, cpu.ld8_port(ga));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xe5:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        Dc(13);
                    ga = phys_mem8[Kb++];
                    ;
                    regs[0] = cpu.ld32_port(ga);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xe6:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        Dc(13);
                    ga = phys_mem8[Kb++];
                    ;
                    cpu.st8_port(ga, regs[0] & 0xff);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xe7:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        Dc(13);
                    ga = phys_mem8[Kb++];
                    ;
                    cpu.st32_port(ga, regs[0]);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xec:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        Dc(13);
                    Vb(0, cpu.ld8_port(regs[2] & 0xffff));
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xed:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        Dc(13);
                    regs[0] = cpu.ld32_port(regs[2] & 0xffff);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xee:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        Dc(13);
                    cpu.st8_port(regs[2] & 0xffff, regs[0] & 0xff);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0xef:
                    Sa = (cpu.eflags >> 12) & 3;
                    if (cpu.cpl > Sa)
                        Dc(13);
                    cpu.st32_port(regs[2] & 0xffff, regs[0]);
                    {
                        if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                            break Bg;
                    }
                    ;
                    break Fd;
                case 0x27:
                    Df();
                    break Fd;
                case 0x2f:
                    Ff();
                    break Fd;
                case 0x37:
                    zf();
                    break Fd;
                case 0x3f:
                    Cf();
                    break Fd;
                case 0xd4:
                    ga = phys_mem8[Kb++];
                    ;
                    vf(ga);
                    break Fd;
                case 0xd5:
                    ga = phys_mem8[Kb++];
                    ;
                    yf(ga);
                    break Fd;
                case 0x63:
                    tf();
                    break Fd;
                case 0xd6:
                case 0xf1:
                    Dc(6);
                    break;
                case 0x0f:
                    b = phys_mem8[Kb++];
                    ;
                    switch (b) {
                        case 0x80:
                        case 0x81:
                        case 0x82:
                        case 0x83:
                        case 0x84:
                        case 0x85:
                        case 0x86:
                        case 0x87:
                        case 0x88:
                        case 0x89:
                        case 0x8a:
                        case 0x8b:
                        case 0x8c:
                        case 0x8d:
                        case 0x8e:
                        case 0x8f:
                            {
                                ga = phys_mem8[Kb] | (phys_mem8[Kb + 1] << 8) | (phys_mem8[Kb + 2] << 16) | (phys_mem8[Kb + 3] << 24);
                                Kb += 4;
                            }
                            ;
                            if (fd(b & 0xf))
                                Kb = (Kb + ga) >> 0;
                            break Fd;
                        case 0x90:
                        case 0x91:
                        case 0x92:
                        case 0x93:
                        case 0x94:
                        case 0x95:
                        case 0x96:
                        case 0x97:
                        case 0x98:
                        case 0x99:
                        case 0x9a:
                        case 0x9b:
                        case 0x9c:
                        case 0x9d:
                        case 0x9e:
                        case 0x9f:
                            Ea = phys_mem8[Kb++];
                            ;
                            ga = fd(b & 0xf);
                            if ((Ea >> 6) == 3) {
                                Vb(Ea & 7, ga);
                            } else {
                                fa = Pb(Ea);
                                sb(ga);
                            }
                            break Fd;
                        case 0x40:
                        case 0x41:
                        case 0x42:
                        case 0x43:
                        case 0x44:
                        case 0x45:
                        case 0x46:
                        case 0x47:
                        case 0x48:
                        case 0x49:
                        case 0x4a:
                        case 0x4b:
                        case 0x4c:
                        case 0x4d:
                        case 0x4e:
                        case 0x4f:
                            Ea = phys_mem8[Kb++];
                            ;
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = kb();
                            }
                            if (fd(b & 0xf))
                                regs[(Ea >> 3) & 7] = ga;
                            break Fd;
                        case 0xb6:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = (regs[Fa & 3] >> ((Fa & 4) << 1)) & 0xff;
                            } else {
                                fa = Pb(Ea);
                                ga = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                            }
                            regs[Ga] = ga;
                            break Fd;
                        case 0xb7:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7] & 0xffff;
                            } else {
                                fa = Pb(Ea);
                                ga = ib();
                            }
                            regs[Ga] = ga;
                            break Fd;
                        case 0xbe:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                            } else {
                                fa = Pb(Ea);
                                ga = (((Ua = bb[fa >>> 12]) == -1) ? db() : phys_mem8[fa ^ Ua]);
                            }
                            regs[Ga] = (((ga) << 24) >> 24);
                            break Fd;
                        case 0xbf:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = ib();
                            }
                            regs[Ga] = (((ga) << 16) >> 16);
                            break Fd;
                        case 0x00:
                            if (!(cpu.cr0 & (1 << 0)) || (cpu.eflags & 0x00020000))
                                Dc(6);
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (Ea >> 3) & 7;
                            switch (Ja) {
                                case 0:
                                case 1:
                                    if (Ja == 0)
                                        ga = cpu.ldt.selector;
                                    else
                                        ga = cpu.tr.selector;
                                    if ((Ea >> 6) == 3) {
                                        Wb(Ea & 7, ga);
                                    } else {
                                        fa = Pb(Ea);
                                        ub(ga);
                                    }
                                    break;
                                case 2:
                                case 3:
                                    if (cpu.cpl != 0)
                                        Dc(13);
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7] & 0xffff;
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    if (Ja == 2)
                                        Ce(ga);
                                    else
                                        Ee(ga);
                                    break;
                                case 4:
                                case 5:
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7] & 0xffff;
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    sf(ga, Ja & 1);
                                    break;
                                default:
                                    Dc(6);
                            }
                            break Fd;
                        case 0x01:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (Ea >> 3) & 7;
                            switch (Ja) {
                                case 2:
                                case 3:
                                    if ((Ea >> 6) == 3)
                                        Dc(6);
                                    if (this.cpl != 0)
                                        Dc(13);
                                    fa = Pb(Ea);
                                    ga = ib();
                                    fa += 2;
                                    Ha = kb();
                                    if (Ja == 2) {
                                        this.gdt.base = Ha;
                                        this.gdt.limit = ga;
                                    } else {
                                        this.idt.base = Ha;
                                        this.idt.limit = ga;
                                    }
                                    break;
                                case 7:
                                    if (this.cpl != 0)
                                        Dc(13);
                                    if ((Ea >> 6) == 3)
                                        Dc(6);
                                    fa = Pb(Ea);
                                    cpu.tlb_flush_page(fa & -4096);
                                    break;
                                default:
                                    Dc(6);
                            }
                            break Fd;
                        case 0x02:
                        case 0x03:
                            qf((((Da >> 8) & 1) ^ 1), b & 1);
                            break Fd;
                        case 0x20:
                            if (cpu.cpl != 0)
                                Dc(13);
                            Ea = phys_mem8[Kb++];
                            ;
                            if ((Ea >> 6) != 3)
                                Dc(6);
                            Ga = (Ea >> 3) & 7;
                            switch (Ga) {
                                case 0:
                                    ga = cpu.cr0;
                                    break;
                                case 2:
                                    ga = cpu.cr2;
                                    break;
                                case 3:
                                    ga = cpu.cr3;
                                    break;
                                case 4:
                                    ga = cpu.cr4;
                                    break;
                                default:
                                    Dc(6);
                            }
                            regs[Ea & 7] = ga;
                            break Fd;
                        case 0x22:
                            if (cpu.cpl != 0)
                                Dc(13);
                            Ea = phys_mem8[Kb++];
                            ;
                            if ((Ea >> 6) != 3)
                                Dc(6);
                            Ga = (Ea >> 3) & 7;
                            ga = regs[Ea & 7];
                            switch (Ga) {
                                case 0:
                                    Pd(ga);
                                    break;
                                case 2:
                                    cpu.cr2 = ga;
                                    break;
                                case 3:
                                    Rd(ga);
                                    break;
                                case 4:
                                    Td(ga);
                                    break;
                                default:
                                    Dc(6);
                            }
                            break Fd;
                        case 0x06:
                            if (cpu.cpl != 0)
                                Dc(13);
                            Pd(cpu.cr0 & ~(1 << 3));
                            break Fd;
                        case 0x23:
                            if (cpu.cpl != 0)
                                Dc(13);
                            Ea = phys_mem8[Kb++];
                            ;
                            if ((Ea >> 6) != 3)
                                Dc(6);
                            Ga = (Ea >> 3) & 7;
                            ga = regs[Ea & 7];
                            if (Ga == 4 || Ga == 5)
                                Dc(6);
                            break Fd;
                        case 0xb2:
                        case 0xb4:
                        case 0xb5:
                            Uf(b & 7);
                            break Fd;
                        case 0xa2:
                            uf();
                            break Fd;
                        case 0xa4:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ha = regs[(Ea >> 3) & 7];
                            if ((Ea >> 6) == 3) {
                                Ia = phys_mem8[Kb++];
                                ;
                                Fa = Ea & 7;
                                regs[Fa] = rc(regs[Fa], Ha, Ia);
                            } else {
                                fa = Pb(Ea);
                                Ia = phys_mem8[Kb++];
                                ;
                                ga = qb();
                                ga = rc(ga, Ha, Ia);
                                wb(ga);
                            }
                            break Fd;
                        case 0xa5:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ha = regs[(Ea >> 3) & 7];
                            Ia = regs[1];
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                regs[Fa] = rc(regs[Fa], Ha, Ia);
                            } else {
                                fa = Pb(Ea);
                                ga = qb();
                                ga = rc(ga, Ha, Ia);
                                wb(ga);
                            }
                            break Fd;
                        case 0xac:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ha = regs[(Ea >> 3) & 7];
                            if ((Ea >> 6) == 3) {
                                Ia = phys_mem8[Kb++];
                                ;
                                Fa = Ea & 7;
                                regs[Fa] = sc(regs[Fa], Ha, Ia);
                            } else {
                                fa = Pb(Ea);
                                Ia = phys_mem8[Kb++];
                                ;
                                ga = qb();
                                ga = sc(ga, Ha, Ia);
                                wb(ga);
                            }
                            break Fd;
                        case 0xad:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ha = regs[(Ea >> 3) & 7];
                            Ia = regs[1];
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                regs[Fa] = sc(regs[Fa], Ha, Ia);
                            } else {
                                fa = Pb(Ea);
                                ga = qb();
                                ga = sc(ga, Ha, Ia);
                                wb(ga);
                            }
                            break Fd;
                        case 0xba:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (Ea >> 3) & 7;
                            switch (Ja) {
                                case 4:
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7];
                                        Ha = phys_mem8[Kb++];
                                        ;
                                    } else {
                                        fa = Pb(Ea);
                                        Ha = phys_mem8[Kb++];
                                        ;
                                        ga = kb();
                                    }
                                    uc(ga, Ha);
                                    break;
                                case 5:
                                case 6:
                                case 7:
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        Ha = phys_mem8[Kb++];
                                        ;
                                        regs[Fa] = xc(Ja & 3, regs[Fa], Ha);
                                    } else {
                                        fa = Pb(Ea);
                                        Ha = phys_mem8[Kb++];
                                        ;
                                        ga = qb();
                                        ga = xc(Ja & 3, ga, Ha);
                                        wb(ga);
                                    }
                                    break;
                                default:
                                    Dc(6);
                            }
                            break Fd;
                        case 0xa3:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ha = regs[(Ea >> 3) & 7];
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                fa = (fa + ((Ha >> 5) << 2)) >> 0;
                                ga = kb();
                            }
                            uc(ga, Ha);
                            break Fd;
                        case 0xab:
                        case 0xb3:
                        case 0xbb:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ha = regs[(Ea >> 3) & 7];
                            Ja = (b >> 3) & 3;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                regs[Fa] = xc(Ja, regs[Fa], Ha);
                            } else {
                                fa = Pb(Ea);
                                fa = (fa + ((Ha >> 5) << 2)) >> 0;
                                ga = qb();
                                ga = xc(Ja, ga, Ha);
                                wb(ga);
                            }
                            break Fd;
                        case 0xbc:
                        case 0xbd:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Ha = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                Ha = kb();
                            }
                            if (b & 1)
                                regs[Ga] = Bc(regs[Ga], Ha);
                            else
                                regs[Ga] = zc(regs[Ga], Ha);
                            break Fd;
                        case 0xaf:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Ha = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                Ha = kb();
                            }
                            regs[Ga] = Wc(regs[Ga], Ha);
                            break Fd;
                        case 0x31:
                            if ((cpu.cr4 & (1 << 2)) && cpu.cpl != 0)
                                Dc(13);
                            ga = md();
                            regs[0] = ga >>> 0;
                            regs[2] = (ga / 0x100000000) >>> 0;
                            break Fd;
                        case 0xc0:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                                Ha = gc(0, ga, (regs[Ga & 3] >> ((Ga & 4) << 1)));
                                Vb(Ga, ga);
                                Vb(Fa, Ha);
                            } else {
                                fa = Pb(Ea);
                                ga = mb();
                                Ha = gc(0, ga, (regs[Ga & 3] >> ((Ga & 4) << 1)));
                                sb(Ha);
                                Vb(Ga, ga);
                            }
                            break Fd;
                        case 0xc1:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = regs[Fa];
                                Ha = Xb(0, ga, regs[Ga]);
                                regs[Ga] = ga;
                                regs[Fa] = Ha;
                            } else {
                                fa = Pb(Ea);
                                ga = qb();
                                Ha = Xb(0, ga, regs[Ga]);
                                wb(Ha);
                                regs[Ga] = ga;
                            }
                            break Fd;
                        case 0xb0:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                                Ha = gc(5, regs[0], ga);
                                if (Ha == 0) {
                                    Vb(Fa, (regs[Ga & 3] >> ((Ga & 4) << 1)));
                                } else {
                                    Vb(0, ga);
                                }
                            } else {
                                fa = Pb(Ea);
                                ga = mb();
                                Ha = gc(5, regs[0], ga);
                                if (Ha == 0) {
                                    sb((regs[Ga & 3] >> ((Ga & 4) << 1)));
                                } else {
                                    Vb(0, ga);
                                }
                            }
                            break Fd;
                        case 0xb1:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = regs[Fa];
                                Ha = Xb(5, regs[0], ga);
                                if (Ha == 0) {
                                    regs[Fa] = regs[Ga];
                                } else {
                                    regs[0] = ga;
                                }
                            } else {
                                fa = Pb(Ea);
                                ga = qb();
                                Ha = Xb(5, regs[0], ga);
                                if (Ha == 0) {
                                    wb(regs[Ga]);
                                } else {
                                    regs[0] = ga;
                                }
                            }
                            break Fd;
                        case 0xa0:
                        case 0xa8:
                            xd(cpu.segs[(b >> 3) & 7].selector);
                            break Fd;
                        case 0xa1:
                        case 0xa9:
                            Ie((b >> 3) & 7, Ad() & 0xffff);
                            Bd();
                            break Fd;
                        case 0xc8:
                        case 0xc9:
                        case 0xca:
                        case 0xcb:
                        case 0xcc:
                        case 0xcd:
                        case 0xce:
                        case 0xcf:
                            Ga = b & 7;
                            ga = regs[Ga];
                            ga = (ga >>> 24) | ((ga >> 8) & 0x0000ff00) | ((ga << 8) & 0x00ff0000) | (ga << 24);
                            regs[Ga] = ga;
                            break Fd;
                        case 0x04:
                        case 0x05:
                        case 0x07:
                        case 0x08:
                        case 0x09:
                        case 0x0a:
                        case 0x0b:
                        case 0x0c:
                        case 0x0d:
                        case 0x0e:
                        case 0x0f:
                        case 0x10:
                        case 0x11:
                        case 0x12:
                        case 0x13:
                        case 0x14:
                        case 0x15:
                        case 0x16:
                        case 0x17:
                        case 0x18:
                        case 0x19:
                        case 0x1a:
                        case 0x1b:
                        case 0x1c:
                        case 0x1d:
                        case 0x1e:
                        case 0x1f:
                        case 0x21:
                        case 0x24:
                        case 0x25:
                        case 0x26:
                        case 0x27:
                        case 0x28:
                        case 0x29:
                        case 0x2a:
                        case 0x2b:
                        case 0x2c:
                        case 0x2d:
                        case 0x2e:
                        case 0x2f:
                        case 0x30:
                        case 0x32:
                        case 0x33:
                        case 0x34:
                        case 0x35:
                        case 0x36:
                        case 0x37:
                        case 0x38:
                        case 0x39:
                        case 0x3a:
                        case 0x3b:
                        case 0x3c:
                        case 0x3d:
                        case 0x3e:
                        case 0x3f:
                        case 0x50:
                        case 0x51:
                        case 0x52:
                        case 0x53:
                        case 0x54:
                        case 0x55:
                        case 0x56:
                        case 0x57:
                        case 0x58:
                        case 0x59:
                        case 0x5a:
                        case 0x5b:
                        case 0x5c:
                        case 0x5d:
                        case 0x5e:
                        case 0x5f:
                        case 0x60:
                        case 0x61:
                        case 0x62:
                        case 0x63:
                        case 0x64:
                        case 0x65:
                        case 0x66:
                        case 0x67:
                        case 0x68:
                        case 0x69:
                        case 0x6a:
                        case 0x6b:
                        case 0x6c:
                        case 0x6d:
                        case 0x6e:
                        case 0x6f:
                        case 0x70:
                        case 0x71:
                        case 0x72:
                        case 0x73:
                        case 0x74:
                        case 0x75:
                        case 0x76:
                        case 0x77:
                        case 0x78:
                        case 0x79:
                        case 0x7a:
                        case 0x7b:
                        case 0x7c:
                        case 0x7d:
                        case 0x7e:
                        case 0x7f:
                        case 0xa6:
                        case 0xa7:
                        case 0xaa:
                        case 0xae:
                        case 0xb8:
                        case 0xb9:
                        case 0xc2:
                        case 0xc3:
                        case 0xc4:
                        case 0xc5:
                        case 0xc6:
                        case 0xc7:
                        case 0xd0:
                        case 0xd1:
                        case 0xd2:
                        case 0xd3:
                        case 0xd4:
                        case 0xd5:
                        case 0xd6:
                        case 0xd7:
                        case 0xd8:
                        case 0xd9:
                        case 0xda:
                        case 0xdb:
                        case 0xdc:
                        case 0xdd:
                        case 0xde:
                        case 0xdf:
                        case 0xe0:
                        case 0xe1:
                        case 0xe2:
                        case 0xe3:
                        case 0xe4:
                        case 0xe5:
                        case 0xe6:
                        case 0xe7:
                        case 0xe8:
                        case 0xe9:
                        case 0xea:
                        case 0xeb:
                        case 0xec:
                        case 0xed:
                        case 0xee:
                        case 0xef:
                        case 0xf0:
                        case 0xf1:
                        case 0xf2:
                        case 0xf3:
                        case 0xf4:
                        case 0xf5:
                        case 0xf6:
                        case 0xf7:
                        case 0xf8:
                        case 0xf9:
                        case 0xfa:
                        case 0xfb:
                        case 0xfc:
                        case 0xfd:
                        case 0xfe:
                        case 0xff:
                        default:
                            Dc(6);
                    }
                    break;
                default:
                    switch (b) {
                        case 0x189:
                            Ea = phys_mem8[Kb++];
                            ;
                            ga = regs[(Ea >> 3) & 7];
                            if ((Ea >> 6) == 3) {
                                Wb(Ea & 7, ga);
                            } else {
                                fa = Pb(Ea);
                                ub(ga);
                            }
                            break Fd;
                        case 0x18b:
                            Ea = phys_mem8[Kb++];
                            ;
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = ib();
                            }
                            Wb((Ea >> 3) & 7, ga);
                            break Fd;
                        case 0x1b8:
                        case 0x1b9:
                        case 0x1ba:
                        case 0x1bb:
                        case 0x1bc:
                        case 0x1bd:
                        case 0x1be:
                        case 0x1bf:
                            Wb(b & 7, Ob());
                            break Fd;
                        case 0x1a1:
                            fa = Ub();
                            ga = ib();
                            Wb(0, ga);
                            break Fd;
                        case 0x1a3:
                            fa = Ub();
                            ub(regs[0]);
                            break Fd;
                        case 0x1c7:
                            Ea = phys_mem8[Kb++];
                            ;
                            if ((Ea >> 6) == 3) {
                                ga = Ob();
                                Wb(Ea & 7, ga);
                            } else {
                                fa = Pb(Ea);
                                ga = Ob();
                                ub(ga);
                            }
                            break Fd;
                        case 0x191:
                        case 0x192:
                        case 0x193:
                        case 0x194:
                        case 0x195:
                        case 0x196:
                        case 0x197:
                            Ga = b & 7;
                            ga = regs[0];
                            Wb(0, regs[Ga]);
                            Wb(Ga, ga);
                            break Fd;
                        case 0x187:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                ga = regs[Fa];
                                Wb(Fa, regs[Ga]);
                            } else {
                                fa = Pb(Ea);
                                ga = ob();
                                ub(regs[Ga]);
                            }
                            Wb(Ga, ga);
                            break Fd;
                        case 0x1c4:
                            Vf(0);
                            break Fd;
                        case 0x1c5:
                            Vf(3);
                            break Fd;
                        case 0x101:
                        case 0x109:
                        case 0x111:
                        case 0x119:
                        case 0x121:
                        case 0x129:
                        case 0x131:
                        case 0x139:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (b >> 3) & 7;
                            Ha = regs[(Ea >> 3) & 7];
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                Wb(Fa, dc(Ja, regs[Fa], Ha));
                            } else {
                                fa = Pb(Ea);
                                if (Ja != 7) {
                                    ga = ob();
                                    ga = dc(Ja, ga, Ha);
                                    ub(ga);
                                } else {
                                    ga = ib();
                                    dc(7, ga, Ha);
                                }
                            }
                            break Fd;
                        case 0x103:
                        case 0x10b:
                        case 0x113:
                        case 0x11b:
                        case 0x123:
                        case 0x12b:
                        case 0x133:
                        case 0x13b:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (b >> 3) & 7;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Ha = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                Ha = ib();
                            }
                            Wb(Ga, dc(Ja, regs[Ga], Ha));
                            break Fd;
                        case 0x105:
                        case 0x10d:
                        case 0x115:
                        case 0x11d:
                        case 0x125:
                        case 0x12d:
                        case 0x135:
                        case 0x13d:
                            Ha = Ob();
                            Ja = (b >> 3) & 7;
                            Wb(0, dc(Ja, regs[0], Ha));
                            break Fd;
                        case 0x181:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                Ha = Ob();
                                regs[Fa] = dc(Ja, regs[Fa], Ha);
                            } else {
                                fa = Pb(Ea);
                                Ha = Ob();
                                if (Ja != 7) {
                                    ga = ob();
                                    ga = dc(Ja, ga, Ha);
                                    ub(ga);
                                } else {
                                    ga = ib();
                                    dc(7, ga, Ha);
                                }
                            }
                            break Fd;
                        case 0x183:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                Ha = ((phys_mem8[Kb++] << 24) >> 24);
                                ;
                                Wb(Fa, dc(Ja, regs[Fa], Ha));
                            } else {
                                fa = Pb(Ea);
                                Ha = ((phys_mem8[Kb++] << 24) >> 24);
                                ;
                                if (Ja != 7) {
                                    ga = ob();
                                    ga = dc(Ja, ga, Ha);
                                    ub(ga);
                                } else {
                                    ga = ib();
                                    dc(7, ga, Ha);
                                }
                            }
                            break Fd;
                        case 0x140:
                        case 0x141:
                        case 0x142:
                        case 0x143:
                        case 0x144:
                        case 0x145:
                        case 0x146:
                        case 0x147:
                            Ga = b & 7;
                            Wb(Ga, ec(regs[Ga]));
                            break Fd;
                        case 0x148:
                        case 0x149:
                        case 0x14a:
                        case 0x14b:
                        case 0x14c:
                        case 0x14d:
                        case 0x14e:
                        case 0x14f:
                            Ga = b & 7;
                            Wb(Ga, fc(regs[Ga]));
                            break Fd;
                        case 0x16b:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Ha = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                Ha = ib();
                            }
                            Ia = ((phys_mem8[Kb++] << 24) >> 24);
                            ;
                            Wb(Ga, Rc(Ha, Ia));
                            break Fd;
                        case 0x169:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ga = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Ha = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                Ha = ib();
                            }
                            Ia = Ob();
                            Wb(Ga, Rc(Ha, Ia));
                            break Fd;
                        case 0x185:
                            Ea = phys_mem8[Kb++];
                            ;
                            if ((Ea >> 6) == 3) {
                                ga = regs[Ea & 7];
                            } else {
                                fa = Pb(Ea);
                                ga = ib();
                            }
                            Ha = regs[(Ea >> 3) & 7];
                            {
                                _dst = (((ga & Ha) << 16) >> 16);
                                _op = 13;
                            }
                            ;
                            break Fd;
                        case 0x1a9:
                            Ha = Ob();
                            {
                                _dst = (((regs[0] & Ha) << 16) >> 16);
                                _op = 13;
                            }
                            ;
                            break Fd;
                        case 0x1f7:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (Ea >> 3) & 7;
                            switch (Ja) {
                                case 0:
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7];
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    Ha = Ob();
                                    {
                                        _dst = (((ga & Ha) << 16) >> 16);
                                        _op = 13;
                                    }
                                    ;
                                    break;
                                case 2:
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        Wb(Fa, ~regs[Fa]);
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ob();
                                        ga = ~ga;
                                        ub(ga);
                                    }
                                    break;
                                case 3:
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        Wb(Fa, dc(5, 0, regs[Fa]));
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ob();
                                        ga = dc(5, 0, ga);
                                        ub(ga);
                                    }
                                    break;
                                case 4:
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7];
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    ga = Qc(regs[0], ga);
                                    Wb(0, ga);
                                    Wb(2, ga >> 16);
                                    break;
                                case 5:
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7];
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    ga = Rc(regs[0], ga);
                                    Wb(0, ga);
                                    Wb(2, ga >> 16);
                                    break;
                                case 6:
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7];
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    Fc(ga);
                                    break;
                                case 7:
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7];
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    Gc(ga);
                                    break;
                                default:
                                    Dc(6);
                            }
                            break Fd;
                        case 0x1c1:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Ha = phys_mem8[Kb++];
                                ;
                                Fa = Ea & 7;
                                Wb(Fa, mc(Ja, regs[Fa], Ha));
                            } else {
                                fa = Pb(Ea);
                                Ha = phys_mem8[Kb++];
                                ;
                                ga = ob();
                                ga = mc(Ja, ga, Ha);
                                ub(ga);
                            }
                            break Fd;
                        case 0x1d1:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (Ea >> 3) & 7;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                Wb(Fa, mc(Ja, regs[Fa], 1));
                            } else {
                                fa = Pb(Ea);
                                ga = ob();
                                ga = mc(Ja, ga, 1);
                                ub(ga);
                            }
                            break Fd;
                        case 0x1d3:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (Ea >> 3) & 7;
                            Ha = regs[1] & 0xff;
                            if ((Ea >> 6) == 3) {
                                Fa = Ea & 7;
                                Wb(Fa, mc(Ja, regs[Fa], Ha));
                            } else {
                                fa = Pb(Ea);
                                ga = ob();
                                ga = mc(Ja, ga, Ha);
                                ub(ga);
                            }
                            break Fd;
                        case 0x198:
                            Wb(0, (regs[0] << 24) >> 24);
                            break Fd;
                        case 0x199:
                            Wb(2, (regs[0] << 16) >> 31);
                            break Fd;
                        case 0x190:
                            break Fd;
                        case 0x150:
                        case 0x151:
                        case 0x152:
                        case 0x153:
                        case 0x154:
                        case 0x155:
                        case 0x156:
                        case 0x157:
                            vd(regs[b & 7]);
                            break Fd;
                        case 0x158:
                        case 0x159:
                        case 0x15a:
                        case 0x15b:
                        case 0x15c:
                        case 0x15d:
                        case 0x15e:
                        case 0x15f:
                            ga = yd();
                            zd();
                            Wb(b & 7, ga);
                            break Fd;
                        case 0x160:
                            Jf();
                            break Fd;
                        case 0x161:
                            Lf();
                            break Fd;
                        case 0x18f:
                            Ea = phys_mem8[Kb++];
                            ;
                            if ((Ea >> 6) == 3) {
                                ga = yd();
                                zd();
                                Wb(Ea & 7, ga);
                            } else {
                                ga = yd();
                                Ha = regs[4];
                                zd();
                                Ia = regs[4];
                                fa = Pb(Ea);
                                regs[4] = Ha;
                                ub(ga);
                                regs[4] = Ia;
                            }
                            break Fd;
                        case 0x168:
                            ga = Ob();
                            vd(ga);
                            break Fd;
                        case 0x16a:
                            ga = ((phys_mem8[Kb++] << 24) >> 24);
                            ;
                            vd(ga);
                            break Fd;
                        case 0x1c8:
                            Pf();
                            break Fd;
                        case 0x1c9:
                            Nf();
                            break Fd;
                        case 0x106:
                        case 0x10e:
                        case 0x116:
                        case 0x11e:
                            vd(cpu.segs[(b >> 3) & 3].selector);
                            break Fd;
                        case 0x107:
                        case 0x117:
                        case 0x11f:
                            Ie((b >> 3) & 3, yd());
                            zd();
                            break Fd;
                        case 0x18d:
                            Ea = phys_mem8[Kb++];
                            ;
                            if ((Ea >> 6) == 3)
                                Dc(6);
                            Da = (Da & ~0x000f) | (6 + 1);
                            Wb((Ea >> 3) & 7, Pb(Ea));
                            break Fd;
                        case 0x1ff:
                            Ea = phys_mem8[Kb++];
                            ;
                            Ja = (Ea >> 3) & 7;
                            switch (Ja) {
                                case 0:
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        Wb(Fa, ec(regs[Fa]));
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ob();
                                        ga = ec(ga);
                                        ub(ga);
                                    }
                                    break;
                                case 1:
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        Wb(Fa, fc(regs[Fa]));
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ob();
                                        ga = fc(ga);
                                        ub(ga);
                                    }
                                    break;
                                case 2:
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7] & 0xffff;
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    vd((Jb + Kb - Mb));
                                    Jb = ga, Kb = Mb = 0;
                                    break;
                                case 4:
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7] & 0xffff;
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    Jb = ga, Kb = Mb = 0;
                                    break;
                                case 6:
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7];
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    vd(ga);
                                    break;
                                case 3:
                                case 5:
                                    if ((Ea >> 6) == 3)
                                        Dc(6);
                                    fa = Pb(Ea);
                                    ga = ib();
                                    fa = (fa + 2) >> 0;
                                    Ha = ib();
                                    if (Ja == 3)
                                        Ze(0, Ha, ga, (Jb + Kb - Mb));
                                    else
                                        Oe(Ha, ga);
                                    break;
                                default:
                                    Dc(6);
                            }
                            break Fd;
                        case 0x1eb:
                            ga = ((phys_mem8[Kb++] << 24) >> 24);
                            ;
                            Jb = (Jb + Kb - Mb + ga) & 0xffff, Kb = Mb = 0;
                            break Fd;
                        case 0x1e9:
                            ga = Ob();
                            Jb = (Jb + Kb - Mb + ga) & 0xffff, Kb = Mb = 0;
                            break Fd;
                        case 0x170:
                        case 0x171:
                        case 0x172:
                        case 0x173:
                        case 0x174:
                        case 0x175:
                        case 0x176:
                        case 0x177:
                        case 0x178:
                        case 0x179:
                        case 0x17a:
                        case 0x17b:
                        case 0x17c:
                        case 0x17d:
                        case 0x17e:
                        case 0x17f:
                            ga = ((phys_mem8[Kb++] << 24) >> 24);
                            ;
                            Ha = fd(b & 0xf);
                            if (Ha)
                                Jb = (Jb + Kb - Mb + ga) & 0xffff, Kb = Mb = 0;
                            break Fd;
                        case 0x1c2:
                            Ha = (Ob() << 16) >> 16;
                            ga = yd();
                            regs[4] = (regs[4] & ~Pa) | ((regs[4] + 2 + Ha) & Pa);
                            Jb = ga, Kb = Mb = 0;
                            break Fd;
                        case 0x1c3:
                            ga = yd();
                            zd();
                            Jb = ga, Kb = Mb = 0;
                            break Fd;
                        case 0x1e8:
                            ga = Ob();
                            vd((Jb + Kb - Mb));
                            Jb = (Jb + Kb - Mb + ga) & 0xffff, Kb = Mb = 0;
                            break Fd;
                        case 0x162:
                            If();
                            break Fd;
                        case 0x1a5:
                            lg();
                            break Fd;
                        case 0x1a7:
                            ng();
                            break Fd;
                        case 0x1ad:
                            og();
                            break Fd;
                        case 0x1af:
                            pg();
                            break Fd;
                        case 0x1ab:
                            mg();
                            break Fd;
                        case 0x16d:
                            jg();
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            ;
                            break Fd;
                        case 0x16f:
                            kg();
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            ;
                            break Fd;
                        case 0x1e5:
                            Sa = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > Sa)
                                Dc(13);
                            ga = phys_mem8[Kb++];
                            ;
                            Wb(0, cpu.ld16_port(ga));
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            ;
                            break Fd;
                        case 0x1e7:
                            Sa = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > Sa)
                                Dc(13);
                            ga = phys_mem8[Kb++];
                            ;
                            cpu.st16_port(ga, regs[0] & 0xffff);
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            ;
                            break Fd;
                        case 0x1ed:
                            Sa = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > Sa)
                                Dc(13);
                            Wb(0, cpu.ld16_port(regs[2] & 0xffff));
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            ;
                            break Fd;
                        case 0x1ef:
                            Sa = (cpu.eflags >> 12) & 3;
                            if (cpu.cpl > Sa)
                                Dc(13);
                            cpu.st16_port(regs[2] & 0xffff, regs[0] & 0xffff);
                            {
                                if (cpu.hard_irq != 0 && (cpu.eflags & 0x00000200))
                                    break Bg;
                            }
                            ;
                            break Fd;
                        case 0x166:
                        case 0x167:
                        case 0x1f0:
                        case 0x1f2:
                        case 0x1f3:
                        case 0x126:
                        case 0x12e:
                        case 0x136:
                        case 0x13e:
                        case 0x164:
                        case 0x165:
                        case 0x100:
                        case 0x108:
                        case 0x110:
                        case 0x118:
                        case 0x120:
                        case 0x128:
                        case 0x130:
                        case 0x138:
                        case 0x102:
                        case 0x10a:
                        case 0x112:
                        case 0x11a:
                        case 0x122:
                        case 0x12a:
                        case 0x132:
                        case 0x13a:
                        case 0x104:
                        case 0x10c:
                        case 0x114:
                        case 0x11c:
                        case 0x124:
                        case 0x12c:
                        case 0x134:
                        case 0x13c:
                        case 0x1a0:
                        case 0x1a2:
                        case 0x1d8:
                        case 0x1d9:
                        case 0x1da:
                        case 0x1db:
                        case 0x1dc:
                        case 0x1dd:
                        case 0x1de:
                        case 0x1df:
                        case 0x184:
                        case 0x1a8:
                        case 0x1f6:
                        case 0x1c0:
                        case 0x1d0:
                        case 0x1d2:
                        case 0x1fe:
                        case 0x1cd:
                        case 0x1ce:
                        case 0x1f5:
                        case 0x1f8:
                        case 0x1f9:
                        case 0x1fc:
                        case 0x1fd:
                        case 0x1fa:
                        case 0x1fb:
                        case 0x19e:
                        case 0x19f:
                        case 0x1f4:
                        case 0x127:
                        case 0x12f:
                        case 0x137:
                        case 0x13f:
                        case 0x1d4:
                        case 0x1d5:
                        case 0x16c:
                        case 0x16e:
                        case 0x1a4:
                        case 0x1a6:
                        case 0x1aa:
                        case 0x1ac:
                        case 0x1ae:
                        case 0x180:
                        case 0x182:
                        case 0x186:
                        case 0x188:
                        case 0x18a:
                        case 0x18c:
                        case 0x18e:
                        case 0x19b:
                        case 0x1b0:
                        case 0x1b1:
                        case 0x1b2:
                        case 0x1b3:
                        case 0x1b4:
                        case 0x1b5:
                        case 0x1b6:
                        case 0x1b7:
                        case 0x1c6:
                        case 0x1cc:
                        case 0x1d7:
                        case 0x1e4:
                        case 0x1e6:
                        case 0x1ec:
                        case 0x1ee:
                        case 0x1cf:
                        case 0x1ca:
                        case 0x1cb:
                        case 0x19a:
                        case 0x19c:
                        case 0x19d:
                        case 0x1ea:
                        case 0x1e0:
                        case 0x1e1:
                        case 0x1e2:
                        case 0x1e3:
                            b &= 0xff;
                            break;
                        case 0x163:
                        case 0x1d6:
                        case 0x1f1:
                        default:
                            Dc(6);
                        case 0x10f:
                            b = phys_mem8[Kb++];
                            ;
                            b |= 0x0100;
                            switch (b) {
                                case 0x180:
                                case 0x181:
                                case 0x182:
                                case 0x183:
                                case 0x184:
                                case 0x185:
                                case 0x186:
                                case 0x187:
                                case 0x188:
                                case 0x189:
                                case 0x18a:
                                case 0x18b:
                                case 0x18c:
                                case 0x18d:
                                case 0x18e:
                                case 0x18f:
                                    ga = Ob();
                                    if (fd(b & 0xf))
                                        Jb = (Jb + Kb - Mb + ga) & 0xffff, Kb = Mb = 0;
                                    break Fd;
                                case 0x140:
                                case 0x141:
                                case 0x142:
                                case 0x143:
                                case 0x144:
                                case 0x145:
                                case 0x146:
                                case 0x147:
                                case 0x148:
                                case 0x149:
                                case 0x14a:
                                case 0x14b:
                                case 0x14c:
                                case 0x14d:
                                case 0x14e:
                                case 0x14f:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7];
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ib();
                                    }
                                    if (fd(b & 0xf))
                                        Wb((Ea >> 3) & 7, ga);
                                    break Fd;
                                case 0x1b6:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ga = (Ea >> 3) & 7;
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        ga = (regs[Fa & 3] >> ((Fa & 4) << 1)) & 0xff;
                                    } else {
                                        fa = Pb(Ea);
                                        ga = gb();
                                    }
                                    Wb(Ga, ga);
                                    break Fd;
                                case 0x1be:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ga = (Ea >> 3) & 7;
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        ga = (regs[Fa & 3] >> ((Fa & 4) << 1));
                                    } else {
                                        fa = Pb(Ea);
                                        ga = gb();
                                    }
                                    Wb(Ga, (((ga) << 24) >> 24));
                                    break Fd;
                                case 0x1af:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ga = (Ea >> 3) & 7;
                                    if ((Ea >> 6) == 3) {
                                        Ha = regs[Ea & 7];
                                    } else {
                                        fa = Pb(Ea);
                                        Ha = ib();
                                    }
                                    Wb(Ga, Rc(regs[Ga], Ha));
                                    break Fd;
                                case 0x1c1:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ga = (Ea >> 3) & 7;
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        ga = regs[Fa];
                                        Ha = dc(0, ga, regs[Ga]);
                                        Wb(Ga, ga);
                                        Wb(Fa, Ha);
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ob();
                                        Ha = dc(0, ga, regs[Ga]);
                                        ub(Ha);
                                        Wb(Ga, ga);
                                    }
                                    break Fd;
                                case 0x1a0:
                                case 0x1a8:
                                    vd(cpu.segs[(b >> 3) & 7].selector);
                                    break Fd;
                                case 0x1a1:
                                case 0x1a9:
                                    Ie((b >> 3) & 7, yd());
                                    zd();
                                    break Fd;
                                case 0x1b2:
                                case 0x1b4:
                                case 0x1b5:
                                    Vf(b & 7);
                                    break Fd;
                                case 0x1a4:
                                case 0x1ac:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ha = regs[(Ea >> 3) & 7];
                                    Ja = (b >> 3) & 1;
                                    if ((Ea >> 6) == 3) {
                                        Ia = phys_mem8[Kb++];
                                        ;
                                        Fa = Ea & 7;
                                        Wb(Fa, oc(Ja, regs[Fa], Ha, Ia));
                                    } else {
                                        fa = Pb(Ea);
                                        Ia = phys_mem8[Kb++];
                                        ;
                                        ga = ob();
                                        ga = oc(Ja, ga, Ha, Ia);
                                        ub(ga);
                                    }
                                    break Fd;
                                case 0x1a5:
                                case 0x1ad:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ha = regs[(Ea >> 3) & 7];
                                    Ia = regs[1];
                                    Ja = (b >> 3) & 1;
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        Wb(Fa, oc(Ja, regs[Fa], Ha, Ia));
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ob();
                                        ga = oc(Ja, ga, Ha, Ia);
                                        ub(ga);
                                    }
                                    break Fd;
                                case 0x1ba:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ja = (Ea >> 3) & 7;
                                    switch (Ja) {
                                        case 4:
                                            if ((Ea >> 6) == 3) {
                                                ga = regs[Ea & 7];
                                                Ha = phys_mem8[Kb++];
                                                ;
                                            } else {
                                                fa = Pb(Ea);
                                                Ha = phys_mem8[Kb++];
                                                ;
                                                ga = ib();
                                            }
                                            tc(ga, Ha);
                                            break;
                                        case 5:
                                        case 6:
                                        case 7:
                                            if ((Ea >> 6) == 3) {
                                                Fa = Ea & 7;
                                                Ha = phys_mem8[Kb++];
                                                ;
                                                regs[Fa] = vc(Ja & 3, regs[Fa], Ha);
                                            } else {
                                                fa = Pb(Ea);
                                                Ha = phys_mem8[Kb++];
                                                ;
                                                ga = ob();
                                                ga = vc(Ja & 3, ga, Ha);
                                                ub(ga);
                                            }
                                            break;
                                        default:
                                            Dc(6);
                                    }
                                    break Fd;
                                case 0x1a3:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ha = regs[(Ea >> 3) & 7];
                                    if ((Ea >> 6) == 3) {
                                        ga = regs[Ea & 7];
                                    } else {
                                        fa = Pb(Ea);
                                        fa = (fa + (((Ha & 0xffff) >> 4) << 1)) >> 0;
                                        ga = ib();
                                    }
                                    tc(ga, Ha);
                                    break Fd;
                                case 0x1ab:
                                case 0x1b3:
                                case 0x1bb:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ha = regs[(Ea >> 3) & 7];
                                    Ja = (b >> 3) & 3;
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        Wb(Fa, vc(Ja, regs[Fa], Ha));
                                    } else {
                                        fa = Pb(Ea);
                                        fa = (fa + (((Ha & 0xffff) >> 4) << 1)) >> 0;
                                        ga = ob();
                                        ga = vc(Ja, ga, Ha);
                                        ub(ga);
                                    }
                                    break Fd;
                                case 0x1bc:
                                case 0x1bd:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ga = (Ea >> 3) & 7;
                                    if ((Ea >> 6) == 3) {
                                        Ha = regs[Ea & 7];
                                    } else {
                                        fa = Pb(Ea);
                                        Ha = ib();
                                    }
                                    ga = regs[Ga];
                                    if (b & 1)
                                        ga = Ac(ga, Ha);
                                    else
                                        ga = yc(ga, Ha);
                                    Wb(Ga, ga);
                                    break Fd;
                                case 0x1b1:
                                    Ea = phys_mem8[Kb++];
                                    ;
                                    Ga = (Ea >> 3) & 7;
                                    if ((Ea >> 6) == 3) {
                                        Fa = Ea & 7;
                                        ga = regs[Fa];
                                        Ha = dc(5, regs[0], ga);
                                        if (Ha == 0) {
                                            Wb(Fa, regs[Ga]);
                                        } else {
                                            Wb(0, ga);
                                        }
                                    } else {
                                        fa = Pb(Ea);
                                        ga = ob();
                                        Ha = dc(5, regs[0], ga);
                                        if (Ha == 0) {
                                            ub(regs[Ga]);
                                        } else {
                                            Wb(0, ga);
                                        }
                                    }
                                    break Fd;
                                case 0x100:
                                case 0x101:
                                case 0x102:
                                case 0x103:
                                case 0x120:
                                case 0x122:
                                case 0x106:
                                case 0x123:
                                case 0x1a2:
                                case 0x131:
                                case 0x190:
                                case 0x191:
                                case 0x192:
                                case 0x193:
                                case 0x194:
                                case 0x195:
                                case 0x196:
                                case 0x197:
                                case 0x198:
                                case 0x199:
                                case 0x19a:
                                case 0x19b:
                                case 0x19c:
                                case 0x19d:
                                case 0x19e:
                                case 0x19f:
                                case 0x1b0:
                                    b = 0x0f;
                                    Kb--;
                                    break;
                                case 0x104:
                                case 0x105:
                                case 0x107:
                                case 0x108:
                                case 0x109:
                                case 0x10a:
                                case 0x10b:
                                case 0x10c:
                                case 0x10d:
                                case 0x10e:
                                case 0x10f:
                                case 0x110:
                                case 0x111:
                                case 0x112:
                                case 0x113:
                                case 0x114:
                                case 0x115:
                                case 0x116:
                                case 0x117:
                                case 0x118:
                                case 0x119:
                                case 0x11a:
                                case 0x11b:
                                case 0x11c:
                                case 0x11d:
                                case 0x11e:
                                case 0x11f:
                                case 0x121:
                                case 0x124:
                                case 0x125:
                                case 0x126:
                                case 0x127:
                                case 0x128:
                                case 0x129:
                                case 0x12a:
                                case 0x12b:
                                case 0x12c:
                                case 0x12d:
                                case 0x12e:
                                case 0x12f:
                                case 0x130:
                                case 0x132:
                                case 0x133:
                                case 0x134:
                                case 0x135:
                                case 0x136:
                                case 0x137:
                                case 0x138:
                                case 0x139:
                                case 0x13a:
                                case 0x13b:
                                case 0x13c:
                                case 0x13d:
                                case 0x13e:
                                case 0x13f:
                                case 0x150:
                                case 0x151:
                                case 0x152:
                                case 0x153:
                                case 0x154:
                                case 0x155:
                                case 0x156:
                                case 0x157:
                                case 0x158:
                                case 0x159:
                                case 0x15a:
                                case 0x15b:
                                case 0x15c:
                                case 0x15d:
                                case 0x15e:
                                case 0x15f:
                                case 0x160:
                                case 0x161:
                                case 0x162:
                                case 0x163:
                                case 0x164:
                                case 0x165:
                                case 0x166:
                                case 0x167:
                                case 0x168:
                                case 0x169:
                                case 0x16a:
                                case 0x16b:
                                case 0x16c:
                                case 0x16d:
                                case 0x16e:
                                case 0x16f:
                                case 0x170:
                                case 0x171:
                                case 0x172:
                                case 0x173:
                                case 0x174:
                                case 0x175:
                                case 0x176:
                                case 0x177:
                                case 0x178:
                                case 0x179:
                                case 0x17a:
                                case 0x17b:
                                case 0x17c:
                                case 0x17d:
                                case 0x17e:
                                case 0x17f:
                                case 0x1a6:
                                case 0x1a7:
                                case 0x1aa:
                                case 0x1ae:
                                case 0x1b7:
                                case 0x1b8:
                                case 0x1b9:
                                case 0x1bf:
                                case 0x1c0:
                                default:
                                    Dc(6);
                            }
                            break;
                    }
            }
        }
    } while (--Ka);
    this.cycle_count += (ua - Ka);
    this.eip = (Jb + Kb - Mb);
    this.cc_src = _src;
    this.cc_dst = _dst;
    this.cc_op = _op;
    this.cc_op2 = Ba;
    this.cc_dst2 = Ca;
    return La;
};


CPU_X86.prototype.exec = function(ua) {
    var Dg, La, Eg, va;
    Eg = this.cycle_count + ua;
    La = 256;
    va = null;
    while (this.cycle_count < Eg) {
        try {
            La = this.exec_internal(Eg - this.cycle_count, va);
            if (La != 256)
                break;
            va = null;
        } catch (Fg) {
            if (Fg.hasOwnProperty("intno")) {
                va = Fg;
            } else {
                throw Fg;
            }
        }
    }
    return La;
};

CPU_X86.prototype.load_binary_ie9 = function(Gg, fa) {
    var Hg, Ig, tg, i;
    Hg = new XMLHttpRequest();
    Hg.open('GET', Gg, false);
    Hg.send(null);
    if (Hg.status != 200 && Hg.status != 0) {
        throw "Error while loading " + Gg;
    }
    Ig = new VBArray(Hg.responseBody).toArray();
    tg = Ig.length;
    for (i = 0; i < tg; i++) {
        this.st8_phys(fa + i, Ig[i]);
    }
    return tg;
};

CPU_X86.prototype.load_binary = function(Gg, fa) {
    var Hg, Ig, tg, i, Jg, Kg;
    if (typeof ActiveXObject == "function")
        return this.load_binary_ie9(Gg, fa);
    Hg = new XMLHttpRequest();
    Hg.open('GET', Gg, false);
    Kg = ('ArrayBuffer' in window && 'Uint8Array' in window);
    if (Kg && 'mozResponseType' in Hg) {
        Hg.mozResponseType = 'arraybuffer';
    } else if (Kg && 'responseType' in Hg) {
        Hg.responseType = 'arraybuffer';
    } else {
        Hg.overrideMimeType('text/plain; charset=x-user-defined');
        Kg = false;
    }
    Hg.send(null);
    if (Hg.status != 200 && Hg.status != 0) {
        throw "Error while loading " + Gg;
    }
    if (Kg && 'mozResponse' in Hg) {
        Ig = Hg.mozResponse;
    } else if (Kg && Hg.mozResponseArrayBuffer) {
        Ig = Hg.mozResponseArrayBuffer;
    } else if ('responseType' in Hg) {
        Ig = Hg.response;
    } else {
        Ig = Hg.responseText;
        Kg = false;
    }
    if (Kg) {
        tg = Ig.byteLength;
        Jg = new Uint8Array(Ig, 0, tg);
        for (i = 0; i < tg; i++) {
            this.st8_phys(fa + i, Jg[i]);
        }
    } else {
        tg = Ig.length;
        for (i = 0; i < tg; i++) {
            this.st8_phys(fa + i, Ig.charCodeAt(i));
        }
    }
    return tg;
};


function Lg(a) {
    return ((a / 10) << 4) | (a % 10);
}
function CMOS(Ng) {
    var Og, d;
    Og = new Uint8Array(128);
    this.cmos_data = Og;
    this.cmos_index = 0;
    d = new Date();
    Og[0] = Lg(d.getUTCSeconds());
    Og[2] = Lg(d.getUTCMinutes());
    Og[4] = Lg(d.getUTCHours());
    Og[6] = Lg(d.getUTCDay());
    Og[7] = Lg(d.getUTCDate());
    Og[8] = Lg(d.getUTCMonth() + 1);
    Og[9] = Lg(d.getUTCFullYear() % 100);
    Og[10] = 0x26;
    Og[11] = 0x02;
    Og[12] = 0x00;
    Og[13] = 0x80;
    Og[0x14] = 0x02;
    Ng.register_ioport_write(0x70, 2, 1, this.ioport_write.bind(this));
    Ng.register_ioport_read(0x70, 2, 1, this.ioport_read.bind(this));
}
CMOS.prototype.ioport_write = function(fa, Ig) {
    if (fa == 0x70) {
        this.cmos_index = Ig & 0x7f;
    }
};
CMOS.prototype.ioport_read = function(fa) {
    var Pg;
    if (fa == 0x70) {
        return 0xff;
    } else {
        Pg = this.cmos_data[this.cmos_index];
        if (this.cmos_index == 10)
            this.cmos_data[10] ^= 0x80;
        else if (this.cmos_index == 12)
            this.cmos_data[12] = 0x00;
        return Pg;
    }
};

function Qg(Ng, Zf) {
    Ng.register_ioport_write(Zf, 2, 1, this.ioport_write.bind(this));
    Ng.register_ioport_read(Zf, 2, 1, this.ioport_read.bind(this));
    this.reset();
}
Qg.prototype.reset = function() {
    this.last_irr = 0;
    this.irr = 0;
    this.imr = 0;
    this.isr = 0;
    this.priority_add = 0;
    this.irq_base = 0;
    this.read_reg_select = 0;
    this.special_mask = 0;
    this.init_state = 0;
    this.auto_eoi = 0;
    this.rotate_on_autoeoi = 0;
    this.init4 = 0;
    this.elcr = 0;
    this.elcr_mask = 0;
};
Qg.prototype.set_irq1 = function(Rg, Qf) {
    var wc;
    wc = 1 << Rg;
    if (Qf) {
        if ((this.last_irr & wc) == 0)
            this.irr |= wc;
        this.last_irr |= wc;
    } else {
        this.last_irr &= ~wc;
    }
};
Qg.prototype.get_priority = function(wc) {
    var Sg;
    if (wc == 0)
        return -1;
    Sg = 7;
    while ((wc & (1 << ((Sg + this.priority_add) & 7))) == 0)
        Sg--;
    return Sg;
};
Qg.prototype.get_irq = function() {
    var wc, Tg, Sg;
    wc = this.irr & ~this.imr;
    Sg = this.get_priority(wc);
    if (Sg < 0)
        return -1;
    Tg = this.get_priority(this.isr);
    if (Sg > Tg) {
        return Sg;
    } else {
        return -1;
    }
};
Qg.prototype.intack = function(Rg) {
    if (this.auto_eoi) {
        if (this.rotate_on_auto_eoi)
            this.priority_add = (Rg + 1) & 7;
    } else {
        this.isr |= (1 << Rg);
    }
    if (!(this.elcr & (1 << Rg)))
        this.irr &= ~(1 << Rg);
};
Qg.prototype.ioport_write = function(fa, ga) {
    var Sg;
    fa &= 1;
    if (fa == 0) {
        if (ga & 0x10) {
            this.reset();
            this.init_state = 1;
            this.init4 = ga & 1;
            if (ga & 0x02)
                throw "single mode not supported";
            if (ga & 0x08)
                throw "level sensitive irq not supported";
        } else if (ga & 0x08) {
            if (ga & 0x02)
                this.read_reg_select = ga & 1;
            if (ga & 0x40)
                this.special_mask = (ga >> 5) & 1;
        } else {
            switch (ga) {
                case 0x00:
                case 0x80:
                    this.rotate_on_autoeoi = ga >> 7;
                    break;
                case 0x20:
                case 0xa0:
                    Sg = this.get_priority(this.isr);
                    if (Sg >= 0) {
                        this.isr &= ~(1 << ((Sg + this.priority_add) & 7));
                    }
                    if (ga == 0xa0)
                        this.priority_add = (this.priority_add + 1) & 7;
                    break;
                case 0x60:
                case 0x61:
                case 0x62:
                case 0x63:
                case 0x64:
                case 0x65:
                case 0x66:
                case 0x67:
                    Sg = ga & 7;
                    this.isr &= ~(1 << Sg);
                    break;
                case 0xc0:
                case 0xc1:
                case 0xc2:
                case 0xc3:
                case 0xc4:
                case 0xc5:
                case 0xc6:
                case 0xc7:
                    this.priority_add = (ga + 1) & 7;
                    break;
                case 0xe0:
                case 0xe1:
                case 0xe2:
                case 0xe3:
                case 0xe4:
                case 0xe5:
                case 0xe6:
                case 0xe7:
                    Sg = ga & 7;
                    this.isr &= ~(1 << Sg);
                    this.priority_add = (Sg + 1) & 7;
                    break;
            }
        }
    } else {
        switch (this.init_state) {
            case 0:
                this.imr = ga;
                this.update_irq();
                break;
            case 1:
                this.irq_base = ga & 0xf8;
                this.init_state = 2;
                break;
            case 2:
                if (this.init4) {
                    this.init_state = 3;
                } else {
                    this.init_state = 0;
                }
                break;
            case 3:
                this.auto_eoi = (ga >> 1) & 1;
                this.init_state = 0;
                break;
        }
    }
};
Qg.prototype.ioport_read = function(Ug) {
    var fa, Pg;
    fa = Ug & 1;
    if (fa == 0) {
        if (this.read_reg_select)
            Pg = this.isr;
        else
            Pg = this.irr;
    } else {
        Pg = this.imr;
    }
    return Pg;
};









function PIC(Ng, Wg, Ug, Xg) {
    this.pics = new Array();
    this.pics[0] = new Qg(Ng, Wg);
    this.pics[1] = new Qg(Ng, Ug);
    this.pics[0].elcr_mask = 0xf8;
    this.pics[1].elcr_mask = 0xde;
    this.irq_requested = 0;
    this.cpu_set_irq = Xg;
    this.pics[0].update_irq = this.update_irq.bind(this);
    this.pics[1].update_irq = this.update_irq.bind(this);
}
PIC.prototype.update_irq = function() {
    var Yg, Rg;
    Yg = this.pics[1].get_irq();
    if (Yg >= 0) {
        this.pics[0].set_irq1(2, 1);
        this.pics[0].set_irq1(2, 0);
    }
    Rg = this.pics[0].get_irq();
    if (Rg >= 0) {
        this.cpu_set_irq(1);
    } else {
        this.cpu_set_irq(0);
    }
};
PIC.prototype.set_irq = function(Rg, Qf) {
    this.pics[Rg >> 3].set_irq1(Rg & 7, Qf);
    this.update_irq();
};
PIC.prototype.get_hard_intno = function() {
    var Rg, Yg, intno;
    Rg = this.pics[0].get_irq();
    if (Rg >= 0) {
        this.pics[0].intack(Rg);
        if (Rg == 2) {
            Yg = this.pics[1].get_irq();
            if (Yg >= 0) {
                this.pics[1].intack(Yg);
            } else {
                Yg = 7;
            }
            intno = this.pics[1].irq_base + Yg;
            Rg = Yg + 8;
        } else {
            intno = this.pics[0].irq_base + Rg;
        }
    } else {
        Rg = 7;
        intno = this.pics[0].irq_base + Rg;
    }
    this.update_irq();
    return intno;
};



function PIT(Ng, ah, bh) {
    var s, i;
    this.pit_channels = new Array();
    for (i = 0; i < 3; i++) {
        s = new IRQCH(bh);
        this.pit_channels[i] = s;
        s.mode = 3;
        s.gate = (i != 2) >> 0;
        s.pit_load_count(0);
    }
    this.speaker_data_on = 0;
    this.set_irq = ah;
    Ng.register_ioport_write(0x40, 4, 1, this.ioport_write.bind(this));
    Ng.register_ioport_read(0x40, 3, 1, this.ioport_read.bind(this));
    Ng.register_ioport_read(0x61, 1, 1, this.speaker_ioport_read.bind(this));
    Ng.register_ioport_write(0x61, 1, 1, this.speaker_ioport_write.bind(this));
}



function IRQCH(bh) {
    this.count = 0;
    this.latched_count = 0;
    this.rw_state = 0;
    this.mode = 0;
    this.bcd = 0;
    this.gate = 0;
    this.count_load_time = 0;
    this.get_ticks = bh;
    this.pit_time_unit = 1193182 / 2000000;
}
IRQCH.prototype.get_time = function() {
    return Math.floor(this.get_ticks() * this.pit_time_unit);
};
IRQCH.prototype.pit_get_count = function() {
    var d, dh;
    d = this.get_time() - this.count_load_time;
    switch (this.mode) {
        case 0:
        case 1:
        case 4:
        case 5:
            dh = (this.count - d) & 0xffff;
            break;
        default:
            dh = this.count - (d % this.count);
            break;
    }
    return dh;
};
IRQCH.prototype.pit_get_out = function() {
    var d, eh;
    d = this.get_time() - this.count_load_time;
    switch (this.mode) {
        default:
        case 0:
            eh = (d >= this.count) >> 0;
            break;
        case 1:
            eh = (d < this.count) >> 0;
            break;
        case 2:
            if ((d % this.count) == 0 && d != 0)
                eh = 1;
            else
                eh = 0;
            break;
        case 3:
            eh = ((d % this.count) < (this.count >> 1)) >> 0;
            break;
        case 4:
        case 5:
            eh = (d == this.count) >> 0;
            break;
    }
    return eh;
};
IRQCH.prototype.get_next_transition_time = function() {
    var d, fh, base, gh;
    d = this.get_time() - this.count_load_time;
    switch (this.mode) {
        default:
        case 0:
        case 1:
            if (d < this.count)
                fh = this.count;
            else
                return -1;
            break;
        case 2:
            base = (d / this.count) * this.count;
            if ((d - base) == 0 && d != 0)
                fh = base + this.count;
            else
                fh = base + this.count + 1;
            break;
        case 3:
            base = (d / this.count) * this.count;
            gh = ((this.count + 1) >> 1);
            if ((d - base) < gh)
                fh = base + gh;
            else
                fh = base + this.count;
            break;
        case 4:
        case 5:
            if (d < this.count)
                fh = this.count;
            else if (d == this.count)
                fh = this.count + 1;
            else
                return -1;
            break;
    }
    fh = this.count_load_time + fh;
    return fh;
};
IRQCH.prototype.pit_load_count = function(ga) {
    if (ga == 0)
        ga = 0x10000;
    this.count_load_time = this.get_time();
    this.count = ga;
};



PIT.prototype.ioport_write = function(fa, ga) {
    var hh, ih, s;
    fa &= 3;
    if (fa == 3) {
        hh = ga >> 6;
        if (hh == 3)
            return;
        s = this.pit_channels[hh];
        ih = (ga >> 4) & 3;
        switch (ih) {
            case 0:
                s.latched_count = s.pit_get_count();
                s.rw_state = 4;
                break;
            default:
                s.mode = (ga >> 1) & 7;
                s.bcd = ga & 1;
                s.rw_state = ih - 1 + 0;
                break;
        }
    } else {
        s = this.pit_channels[fa];
        switch (s.rw_state) {
            case 0:
                s.pit_load_count(ga);
                break;
            case 1:
                s.pit_load_count(ga << 8);
                break;
            case 2:
            case 3:
                if (s.rw_state & 1) {
                    s.pit_load_count((s.latched_count & 0xff) | (ga << 8));
                } else {
                    s.latched_count = ga;
                }
                s.rw_state ^= 1;
                break;
        }
    }
};
PIT.prototype.ioport_read = function(fa) {
    var Pg, ma, s;
    fa &= 3;
    s = this.pit_channels[fa];
    switch (s.rw_state) {
        case 0:
        case 1:
        case 2:
        case 3:
            ma = s.pit_get_count();
            if (s.rw_state & 1)
                Pg = (ma >> 8) & 0xff;
            else
                Pg = ma & 0xff;
            if (s.rw_state & 2)
                s.rw_state ^= 1;
            break;
        default:
        case 4:
        case 5:
            if (s.rw_state & 1)
                Pg = s.latched_count >> 8;
            else
                Pg = s.latched_count & 0xff;
            s.rw_state ^= 1;
            break;
    }
    return Pg;
};
PIT.prototype.speaker_ioport_write = function(fa, ga) {
    this.speaker_data_on = (ga >> 1) & 1;
    this.pit_channels[2].gate = ga & 1;
};
PIT.prototype.speaker_ioport_read = function(fa) {
    var eh, s, ga;
    s = this.pit_channels[2];
    eh = s.pit_get_out();
    ga = (this.speaker_data_on << 1) | s.gate | (eh << 5);
    return ga;
};
PIT.prototype.update_irq = function() {
    this.set_irq(1);
    this.set_irq(0);
};






function Serial(Ng, fa, kh, lh) {
    this.divider = 0;
    this.rbr = 0;
    this.ier = 0;
    this.iir = 0x01;
    this.lcr = 0;
    this.mcr;
    this.lsr = 0x40 | 0x20;
    this.msr = 0;
    this.scr = 0;
    this.set_irq_func = kh;
    this.write_func = lh;
    this.receive_fifo = "";
    Ng.register_ioport_write(0x3f8, 8, 1, this.ioport_write.bind(this));
    Ng.register_ioport_read(0x3f8, 8, 1, this.ioport_read.bind(this));
}
Serial.prototype.update_irq = function() {
    if ((this.lsr & 0x01) && (this.ier & 0x01)) {
        this.iir = 0x04;
    } else if ((this.lsr & 0x20) && (this.ier & 0x02)) {
        this.iir = 0x02;
    } else {
        this.iir = 0x01;
    }
    if (this.iir != 0x01) {
        this.set_irq_func(1);
    } else {
        this.set_irq_func(0);
    }
};
Serial.prototype.ioport_write = function(fa, ga) {
    fa &= 7;
    switch (fa) {
        default:
        case 0:
            if (this.lcr & 0x80) {
                this.divider = (this.divider & 0xff00) | ga;
            } else {
                this.lsr &= ~0x20;
                this.update_irq();
                this.write_func(String.fromCharCode(ga));
                this.lsr |= 0x20;
                this.lsr |= 0x40;
                this.update_irq();
            }
            break;
        case 1:
            if (this.lcr & 0x80) {
                this.divider = (this.divider & 0x00ff) | (ga << 8);
            } else {
                this.ier = ga;
                this.update_irq();
            }
            break;
        case 2:
            break;
        case 3:
            this.lcr = ga;
            break;
        case 4:
            this.mcr = ga;
            break;
        case 5:
            break;
        case 6:
            this.msr = ga;
            break;
        case 7:
            this.scr = ga;
            break;
    }
};
Serial.prototype.ioport_read = function(fa) {
    var Pg;
    fa &= 7;
    switch (fa) {
        default:
        case 0:
            if (this.lcr & 0x80) {
                Pg = this.divider & 0xff;
            } else {
                Pg = this.rbr;
                this.lsr &= ~(0x01 | 0x10);
                this.update_irq();
                this.send_char_from_fifo();
            }
            break;
        case 1:
            if (this.lcr & 0x80) {
                Pg = (this.divider >> 8) & 0xff;
            } else {
                Pg = this.ier;
            }
            break;
        case 2:
            Pg = this.iir;
            break;
        case 3:
            Pg = this.lcr;
            break;
        case 4:
            Pg = this.mcr;
            break;
        case 5:
            Pg = this.lsr;
            break;
        case 6:
            Pg = this.msr;
            break;
        case 7:
            Pg = this.scr;
            break;
    }
    return Pg;
};
Serial.prototype.send_break = function() {
    this.rbr = 0;
    this.lsr |= 0x10 | 0x01;
    this.update_irq();
};
Serial.prototype.send_char = function(mh) {
    this.rbr = mh;
    this.lsr |= 0x01;
    this.update_irq();
};
Serial.prototype.send_char_from_fifo = function() {
    var nh;
    nh = this.receive_fifo;
    if (nh != "" && !(this.lsr & 0x01)) {
        this.send_char(nh.charCodeAt(0));
        this.receive_fifo = nh.substr(1, nh.length - 1);
    }
};
Serial.prototype.send_chars = function(na) {
    this.receive_fifo += na;
    this.send_char_from_fifo();
};



function KBD(Ng, ph) {
    Ng.register_ioport_read(0x64, 1, 1, this.read_status.bind(this));
    Ng.register_ioport_write(0x64, 1, 1, this.write_command.bind(this));
    this.reset_request = ph;
}
KBD.prototype.read_status = function(fa) {
    return 0;
};
KBD.prototype.write_command = function(fa, ga) {
    switch (ga) {
        case 0xfe:
            this.reset_request();
            break;
        default:
            break;
    }
};



function qh(Ng, Zf, rh, lh, sh) {
    Ng.register_ioport_read(Zf, 16, 4, this.ioport_readl.bind(this));
    Ng.register_ioport_write(Zf, 16, 4, this.ioport_writel.bind(this));
    Ng.register_ioport_read(Zf + 8, 1, 1, this.ioport_readb.bind(this));
    Ng.register_ioport_write(Zf + 8, 1, 1, this.ioport_writeb.bind(this));
    this.cur_pos = 0;
    this.doc_str = "";
    this.read_func = rh;
    this.write_func = lh;
    this.get_boot_time = sh;
}
qh.prototype.ioport_writeb = function(fa, ga) {
    this.doc_str += String.fromCharCode(ga);
};
qh.prototype.ioport_readb = function(fa) {
    var c, na, ga;
    na = this.doc_str;
    if (this.cur_pos < na.length) {
        ga = na.charCodeAt(this.cur_pos) & 0xff;
    } else {
        ga = 0;
    }
    this.cur_pos++;
    return ga;
};
qh.prototype.ioport_writel = function(fa, ga) {
    var na;
    fa = (fa >> 2) & 3;
    switch (fa) {
        case 0:
            this.doc_str = this.doc_str.substr(0, ga >>> 0);
            break;
        case 1:
            return this.cur_pos = ga >>> 0;
        case 2:
            na = String.fromCharCode(ga & 0xff) + String.fromCharCode((ga >> 8) & 0xff) + String.fromCharCode((ga >> 16) & 0xff) + String.fromCharCode((ga >> 24) & 0xff);
            this.doc_str += na;
            break;
        case 3:
            this.write_func(this.doc_str);
    }
};
qh.prototype.ioport_readl = function(fa) {
    var ga;
    fa = (fa >> 2) & 3;
    switch (fa) {
        case 0:
            this.doc_str = this.read_func();
            return this.doc_str.length >> 0;
        case 1:
            return this.cur_pos >> 0;
        case 2:
            ga = this.ioport_readb(0);
            ga |= this.ioport_readb(0) << 8;
            ga |= this.ioport_readb(0) << 16;
            ga |= this.ioport_readb(0) << 24;
            return ga;
        case 3:
            if (this.get_boot_time)
                return this.get_boot_time() >> 0;
            else
                return 0;
    }
};

//used only in orig func "PIC"
function Xg(Qf) { this.hard_irq = Qf;}

// unused?
function th() { return this.cycle_count; }





function PCEmulator(uh) {
    var cpu;
    cpu = new CPU_X86();
    this.cpu = cpu;
    cpu.phys_mem_resize(uh.mem_size);
    this.init_ioports();
    this.register_ioport_write(0x80, 1, 1, this.ioport80_write);
    this.pic    = new PIC(this, 0x20, 0xa0, Xg.bind(cpu));
    this.pit    = new PIT(this, this.pic.set_irq.bind(this.pic, 0), th.bind(cpu));
    this.cmos   = new CMOS(this);
    this.serial = new Serial(this, 0x3f8, this.pic.set_irq.bind(this.pic, 4), uh.serial_write);
    this.kbd    = new KBD(this, this.reset.bind(this));
    this.reset_request = 0;
    if (uh.clipboard_get && uh.clipboard_set) {
        this.jsclipboard = new qh(this, 0x3c0, uh.clipboard_get, uh.clipboard_set, uh.get_boot_time);
    }
    cpu.ld8_port       = this.ld8_port.bind(this);
    cpu.ld16_port      = this.ld16_port.bind(this);
    cpu.ld32_port      = this.ld32_port.bind(this);
    cpu.st8_port       = this.st8_port.bind(this);
    cpu.st16_port      = this.st16_port.bind(this);
    cpu.st32_port      = this.st32_port.bind(this);
    cpu.get_hard_intno = this.pic.get_hard_intno.bind(this.pic);
}

PCEmulator.prototype.load_binary = function(Gg, ha) { return this.cpu.load_binary(Gg, ha); };

PCEmulator.prototype.start = function() { setTimeout(this.timer_func.bind(this), 10); };

PCEmulator.prototype.timer_func = function() {
    var La, vh, wh, xh, yh, Ng, cpu;
    Ng = this;
    cpu = Ng.cpu;
    wh = cpu.cycle_count + 100000;
    xh = false;
    yh = false;
    zh: while (cpu.cycle_count < wh) {
        Ng.pit.update_irq();
        La = cpu.exec(wh - cpu.cycle_count);
        if (La == 256) {
            if (Ng.reset_request) {
                xh = true;
                break;
            }
        } else if (La == 257) {
            yh = true;
            break;
        } else {
            xh = true;
            break;
        }
    }
    if (!xh) {
        if (yh) {
            setTimeout(this.timer_func.bind(this), 10);
        } else {
            setTimeout(this.timer_func.bind(this), 0);
        }
    }
};

PCEmulator.prototype.init_ioports = function() {
    var i, Ah, Bh;
    this.ioport_readb_table = new Array();
    this.ioport_writeb_table = new Array();
    this.ioport_readw_table = new Array();
    this.ioport_writew_table = new Array();
    this.ioport_readl_table = new Array();
    this.ioport_writel_table = new Array();
    Ah = this.default_ioport_readw.bind(this);
    Bh = this.default_ioport_writew.bind(this);
    for (i = 0; i < 1024; i++) {
        this.ioport_readb_table[i] = this.default_ioport_readb;
        this.ioport_writeb_table[i] = this.default_ioport_writeb;
        this.ioport_readw_table[i] = Ah;
        this.ioport_writew_table[i] = Bh;
        this.ioport_readl_table[i] = this.default_ioport_readl;
        this.ioport_writel_table[i] = this.default_ioport_writel;
    }
};

PCEmulator.prototype.default_ioport_readb = function(Zf) {
    var ga;
    ga = 0xff;
    return ga;
};

PCEmulator.prototype.default_ioport_readw = function(Zf) {
    var ga;
    ga = this.ioport_readb_table[Zf](Zf);
    Zf = (Zf + 1) & (1024 - 1);
    ga |= this.ioport_readb_table[Zf](Zf) << 8;
    return ga;
};

PCEmulator.prototype.default_ioport_readl = function(Zf) {
    var ga;
    ga = -1;
    return ga;
};

PCEmulator.prototype.default_ioport_writeb = function(Zf, ga) {};

PCEmulator.prototype.default_ioport_writew = function(Zf, ga) {
    this.ioport_writeb_table[Zf](Zf, ga & 0xff);
    Zf = (Zf + 1) & (1024 - 1);
    this.ioport_writeb_table[Zf](Zf, (ga >> 8) & 0xff);
};

PCEmulator.prototype.default_ioport_writel = function(Zf, ga) {};

PCEmulator.prototype.ld8_port = function(Zf) {
    var ga;
    ga = this.ioport_readb_table[Zf & (1024 - 1)](Zf);
    return ga;
};

PCEmulator.prototype.ld16_port = function(Zf) {
    var ga;
    ga = this.ioport_readw_table[Zf & (1024 - 1)](Zf);
    return ga;
};

PCEmulator.prototype.ld32_port = function(Zf) {
    var ga;
    ga = this.ioport_readl_table[Zf & (1024 - 1)](Zf);
    return ga;
};

PCEmulator.prototype.st8_port  = function(Zf, ga) { this.ioport_writeb_table[Zf & (1024 - 1)](Zf, ga); };
PCEmulator.prototype.st16_port = function(Zf, ga) { this.ioport_writew_table[Zf & (1024 - 1)](Zf, ga); };
PCEmulator.prototype.st32_port = function(Zf, ga) { this.ioport_writel_table[Zf & (1024 - 1)](Zf, ga); };

PCEmulator.prototype.register_ioport_read = function(start, tg, cc, Ch) {
    var i;
    switch (cc) {
        case 1:
            for (i = start; i < start + tg; i++) {
                this.ioport_readb_table[i] = Ch;
            }
            break;
        case 2:
            for (i = start; i < start + tg; i += 2) {
                this.ioport_readw_table[i] = Ch;
            }
            break;
        case 4:
            for (i = start; i < start + tg; i += 4) {
                this.ioport_readl_table[i] = Ch;
            }
            break;
    }
};

PCEmulator.prototype.register_ioport_write = function(start, tg, cc, Ch) {
    var i;
    switch (cc) {
        case 1:
            for (i = start; i < start + tg; i++) {
                this.ioport_writeb_table[i] = Ch;
            }
            break;
        case 2:
            for (i = start; i < start + tg; i += 2) {
                this.ioport_writew_table[i] = Ch;
            }
            break;
        case 4:
            for (i = start; i < start + tg; i += 4) {
                this.ioport_writel_table[i] = Ch;
            }
            break;
    }
};

PCEmulator.prototype.ioport80_write = function(fa, Ig) {};
PCEmulator.prototype.reset = function() { this.request_request = 1; };


