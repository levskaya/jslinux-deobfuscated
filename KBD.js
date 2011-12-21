/*
Fabrix - An annotated version of the original JSLinux which is Copyright (c) 2011 Fabrice Bellard

Keyboard Device Emulator
*/
function KBD(Ng, ph) {
    Ng.register_ioport_read(0x64, 1, 1, this.read_status.bind(this));
    Ng.register_ioport_write(0x64, 1, 1, this.write_command.bind(this));
    this.reset_request = ph;
}
KBD.prototype.read_status = function(mem8_loc) {
    return 0;
};
KBD.prototype.write_command = function(mem8_loc, x) {
    switch (x) {
        case 0xfe:
            this.reset_request();
            break;
        default:
            break;
    }
};
