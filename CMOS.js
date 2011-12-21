/*
Fabrix - An annotated version of the original JSLinux which is Copyright (c) 2011 Fabrice Bellard

Clock Emulator
*/
function Lg(a) { return ((a / 10) << 4) | (a % 10);}
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
CMOS.prototype.ioport_write = function(mem8_loc, Ig) {
    if (mem8_loc == 0x70) {
        this.cmos_index = Ig & 0x7f;
    }
};
CMOS.prototype.ioport_read = function(mem8_loc) {
    var Pg;
    if (mem8_loc == 0x70) {
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
